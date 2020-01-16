const isNode =
	typeof process === 'object' &&
	typeof require === 'function' &&
	typeof window !== 'object' &&
	typeof importScripts !== 'function';

const rootScope = isNode ? global : self;

const {isValid: addressIsValid} = require('bitcore-lib/lib/address');
const BitcorePrivateKey = require('bitcore-lib/lib/privatekey');
const BitcoreTransaction = require('bitcore-lib/lib/transaction');
const FormData = require('form-data');
const {ReplaySubject, Subject} = require('rxjs');
const {map, mergeMap} = require('rxjs/operators');

const fetch =
	typeof rootScope.fetch === 'function' ?
		rootScope.fetch :
	isNode ?
		eval('require')('node-fetch') :
		require('whatwg-fetch');

const sleep = async (ms = 250) =>
	new Promise(resolve => {
		setTimeout(resolve, ms);
	});

const locks = {};

const lock = async (id, f, delay = 0) => {
	if (!locks[id]) {
		locks[id] = Promise.resolve();
	}

	const promise = locks[id].then(async () => f());

	locks[id] = promise.catch(() => {}).then(async () => sleep(delay));

	return promise;
};

const request = async (url, opts, delay = 0, maxRetries = 2, retries = 0) => {
	try {
		const o = await lock('request', async () => fetch(url, opts));

		if (o.status !== 200) {
			throw new Error(`Request failure: status ${o.status.toString()}`);
		}

		return o;
	}
	catch (err) {
		if (retries >= maxRetries) {
			throw err;
		}

		await sleep(delay + 1000);
		return request(url, opts, delay, maxRetries, retries + 1);
	}
};

const satoshiConversion = 100000000;
const transactionFee = 5430;

let blockchainAPIKey = undefined;
const blockchainAPIURL = 'https://blockchain.info/';
const blockchainWebSocketURL = 'wss://ws.blockchain.info/inv';

const blockchainAPI = (url, params = {}) => {
	if (params.cors !== false) {
		params.cors = true;
	}

	if (blockchainAPIKey) {
		params.key = blockchainAPIKey;
	}

	return `${blockchainAPIURL + url}?${Object.keys(params)
		.map(k => `${k}=${params[k]}`)
		.join('&')}`;
};

const blockchainAPIRequest = async (url, params) => {
	return request(
		blockchainAPI(url, params),
		undefined,
		blockchainAPIKey ? 0 : 10000
	).then(async o => o.json());
};

const getExchangeRates = async () => {
	const o = await blockchainAPIRequest('ticker');

	for (const k in o) {
		o[k] = o[k].last;
	}

	o.BTC = 1;

	return o;
};

const setBlockchainAPIKey = apiKey => {
	blockchainAPIKey = apiKey;
};

class Wallet {
	constructor (options = {}) {
		this.apiKey = options.apiKey;

		if (options instanceof Wallet) {
			this.address = options.address;
			this.isReadOnly = options.isReadOnly;
			this.localCurrency = options.localCurrency;
			this.key = options.key;
			this.originatingTransactions = options.originatingTransactions;
			this.subjects = {};

			return;
		}

		this.localCurrency = options.localCurrency || 'BTC';

		const key =
			typeof options.key === 'string' ?
				new BitcorePrivateKey(options.key, 'livenet').toBuffer() :
			options.key instanceof Uint8Array ?
				options.key :
				undefined;

		if (key !== undefined) {
			this.key = BitcorePrivateKey.fromObject({
				bn: key,
				compressed: !options.uncompressedPublicKey,
				network: 'livenet'
			});
		}
		else if (!options.address) {
			this.key = new BitcorePrivateKey(undefined, 'livenet');
		}

		this.isReadOnly = this.key === undefined;
		this.address = this.isReadOnly ?
			options.address :
			this.key.toAddress().toString();

		this.originatingTransactions = {};
		this.subjects = {};

		if (!addressIsValid(this.address)) {
			throw new Error(`Invalid Address: ${this.address}.`);
		}
	}

	_friendlyTransaction (transaction, exchangeRate) {
		const senderAddresses = {};
		const recipientAddresses = {};

		const valueIn = transaction.inputs
			.map(o => o.prev_out.value)
			.reduce((a, b) => a + b);

		const valueOut = transaction.out
			.map(o => o.value)
			.reduce((a, b) => a + b);

		const transactionData = {
			amount: undefined,
			valueInLocal: valueIn * exchangeRate,
			valueOutLocal: valueOut * exchangeRate,
			wasSentByMe: false
		};

		transactionData.amount = transactionData.valueOutLocal;

		for (const vin of transaction.inputs.map(o => o.prev_out)) {
			transactionData.wasSentByMe =
				transactionData.wasSentByMe || vin.addr === this.address;

			vin.valueLocal = vin.value * exchangeRate;

			senderAddresses[vin.addr] = true;
		}

		for (const vout of transaction.out) {
			vout.valueLocal = vout.value * exchangeRate;

			if (vout.addr) {
				if (senderAddresses[vout.addr]) {
					transactionData.amount -= vout.valueLocal;
				}
				else {
					recipientAddresses[vout.addr] = true;
				}
			}
		}

		return {
			amount: parseFloat(
				(transactionData.amount / satoshiConversion).toFixed(8)
			),
			baseTransaction: transaction,
			id: transaction.txid,
			isConfirmed: (transaction.confirmations || 0) >= 6,
			recipients: Object.keys(recipientAddresses),
			senders: Object.keys(senderAddresses),
			timestamp: transaction.time * 1000,
			wasSentByMe: transactionData.wasSentByMe
		};
	}

	async _friendlyTransactions (transactions) {
		const [{txs = []}, exchangeRates] = await Promise.all([
			transactions,
			this._getExchangeRates()
		]);

		const exchangeRate = exchangeRates[this.localCurrency];

		return txs.map(tx => this._friendlyTransaction(tx, exchangeRate));
	}

	async _getExchangeRates () {
		return this.localCurrency === 'BTC' ? {BTC: 1} : getExchangeRates();
	}

	_watchTransactions () {
		const subjectID = `_watchTransactions ${this.address}`;

		if (!this.subjects[subjectID]) {
			const subject = new Subject();
			this.subjects[subjectID] = subject;

			const socket = new WebSocket(blockchainWebSocketURL);

			socket.onopen = () => {
				socket.send(
					JSON.stringify({op: 'addr_sub', addr: this.address})
				);
			};

			socket.onmessage = msg => {
				let txid;
				try {
					txid = JSON.parse(msg.data).x.hash;
				}
				catch (_) {}

				if (txid) {
					subject.next(txid);
				}
			};
		}

		return this.subjects[subjectID];
	}

	async createTransaction (recipientAddress, amount) {
		if (this.isReadOnly) {
			throw new Error('Read-only wallet');
		}

		const [balance, unspentResponse] = await Promise.all([
			this.getBalance(),
			blockchainAPIRequest('unspent', {active: this.address}).catch(
				() => ({
					unspent_outputs: []
				})
			)
		]);

		const utxos = ((unspentResponse || {}).unspent_outputs || []).map(
			o => ({
				outputIndex: o.tx_output_n,
				satoshis: o.value,
				scriptPubKey: o.script,
				txid: o.tx_hash_big_endian
			})
		);

		amount = amount / balance._exchangeRates[this.localCurrency];

		if (amount > balance.btc) {
			throw new Error('Insufficient funds');
		}

		for (const utxo of utxos) {
			if (
				this.originatingTransactions[utxo.txid] &&
				!utxo.confirmations
			) {
				utxo.confirmations = 1;
			}
		}

		const createBitcoreTransaction = retries => {
			try {
				return new BitcoreTransaction()
					.from(
						utxos.map(
							utxo => new BitcoreTransaction.UnspentOutput(utxo)
						)
					)
					.to(
						recipientAddress.address ?
							recipientAddress.address :
						recipientAddress.getAddress ?
							recipientAddress.getAddress().toString() :
							recipientAddress,
						Math.floor(amount * satoshiConversion)
					)
					.change(this.address)
					.fee(transactionFee)
					.sign(this.key);
			}
			catch (e) {
				if (retries < 100 && e.message.includes('totalNeededAmount')) {
					amount -= 0.000005;
					return createBitcoreTransaction(retries + 1);
				}
				else {
					throw e;
				}
			}
		};

		return createBitcoreTransaction(0);
	}

	async getBalance () {
		const [balanceResponse, exchangeRates] = await Promise.all([
			blockchainAPIRequest('balance', {active: this.address}),
			this._getExchangeRates()
		]);

		let balance = 0;
		try {
			balance =
				balanceResponse[this.address].final_balance / satoshiConversion;
		}
		catch (_) {}

		return {
			_exchangeRates: exchangeRates,
			btc: balance,
			local: parseFloat(
				(balance * (exchangeRates[this.localCurrency] || 0)).toFixed(2)
			)
		};
	}

	async getTransactionHistory () {
		return this._friendlyTransactions(
			blockchainAPIRequest(`rawaddr/${this.address}`)
		);
	}

	async send (recipientAddress, amount) {
		const transaction = await this.createTransaction(
			recipientAddress,
			amount
		);

		const txid = transaction.id;
		this.originatingTransactions[txid] = true;

		const formData = new FormData();
		formData.append('tx', transaction.serialize());

		return request(blockchainAPI('pushtx'), {
			body: formData,
			method: 'POST'
		}).then(async o => o.text());
	}

	watchNewTransactions (shouldIncludeUnconfirmed = true) {
		const subjectID = `watchNewTransactions ${this.address}`;

		if (!this.subjects[subjectID]) {
			this.subjects[subjectID] = this._watchTransactions().pipe(
				mergeMap(async txid =>
					lock(
						subjectID,
						async () =>
							(await this._friendlyTransactions(
								blockchainAPIRequest(
									`rawtx/${txid}`
								).then(o => [o])
							))[0]
					)
				)
			);
		}

		return shouldIncludeUnconfirmed ?
			this.subjects[subjectID] :
			this.subjects[subjectID].pipe(
				map(transactions =>
					transactions.filter(transaction => transaction.isConfirmed)
				)
			);
	}

	watchTransactionHistory (shouldIncludeUnconfirmed = true) {
		const subjectID = `watchTransactionHistory ${this.address}`;

		if (!this.subjects[subjectID]) {
			const subject = new ReplaySubject(1);
			this.subjects[subjectID] = subject;

			this.getTransactionHistory()
				.then(transactions => {
					subject.next(transactions);

					this._watchTransactions()
						.pipe(
							mergeMap(async () =>
								lock(subjectID, async () =>
									this.getTransactionHistory()
								)
							)
						)
						.subscribe(subject);
				})
				.catch(err => {
					this.subjects[subjectID].error(err);
				});
		}

		return shouldIncludeUnconfirmed ?
			this.subjects[subjectID] :
			this.subjects[subjectID].pipe(
				map(transactions =>
					transactions.filter(transaction => transaction.isConfirmed)
				)
			);
	}
}

const simplebtc = {
	getExchangeRates,
	minimumTransactionAmount:
		BitcoreTransaction.DUST_AMOUNT / satoshiConversion,
	setBlockchainAPIKey,
	transactionFee: transactionFee / satoshiConversion,
	Wallet
};

simplebtc.simplebtc = simplebtc;
module.exports = simplebtc;
