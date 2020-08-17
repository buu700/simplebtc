const isNode =
	typeof process === 'object' &&
	typeof require === 'function' &&
	typeof window !== 'object' &&
	typeof importScripts !== 'function';

const rootScope = isNode ? global : self;

const bitcore = {
	bitcoin: {
		address: require('bitcore-lib/lib/address'),
		BitcorePrivateKey: require('bitcore-lib/lib/privatekey'),
		BitcoreTransaction: require('bitcore-lib/lib/transaction')
	},
	bitcoinCash: {
		address: require('bitcore-lib-cash/lib/address'),
		BitcorePrivateKey: require('bitcore-lib-cash/lib/privatekey'),
		BitcoreTransaction: require('bitcore-lib-cash/lib/transaction')
	}
};

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
const transactionFeesSatoshi = {
	bitcoin: 12000,
	bitcoinCash: 500
};
const transactionFees = {
	bitcoin: transactionFeesSatoshi.bitcoin / satoshiConversion,
	bitcoinCash: transactionFeesSatoshi.bitcoinCash / satoshiConversion
};

let blockchainAPIKey = undefined;
const blockchainAPIURL = 'https://api.blockchain.info/haskoin-store/';
const blockchainWebSocketURL = 'wss://ws.blockchain.info/inv';

const blockchainAPI = (bitcoinCash, url, _PARAMS) => {
	/*
	if (params.cors !== false) {
		params.cors = true;
	}

	if (blockchainAPIKey) {
		params.key = blockchainAPIKey;
	}
	*/

	const baseURL = blockchainAPIURL + (bitcoinCash ? 'bch/' : 'btc/');

	return baseURL + url;
};

const blockchainAPIRequest = async (bitcoinCash, url, params) => {
	return request(
		blockchainAPI(bitcoinCash, url, params),
		undefined,
		/* blockchainAPIKey ? 0 : 10000 */
		10000
	).then(async o => o.json());
};

const getExchangeRates = async bitcoinCash => {
	const [o, conversionRate] = await Promise.all([
		request('https://blockchain.info/ticker').then(async o => o.json()),
		bitcoinCash ?
			(async () =>
				(await request(
					'https://api.coingecko.com/api/v3/exchange_rates'
				).then(o => o.json())).rates.bch.value)() :
			1
	]);

	for (const k of Object.keys(o)) {
		o[k] = o[k].last;

		if (bitcoinCash) {
			o[k] = parseFloat((o[k] / conversionRate).toFixed(2));
		}
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
		this.bitcoinCash = options.bitcoinCash === true;

		this.bitcore = this.bitcoinCash ? bitcore.bitcoinCash : bitcore.bitcoin;

		this.transactionFee = this.bitcoinCash ?
			transactionFees.bitcoinCash :
			transactionFees.bitcoin;
		this.transactionFeeSatoshi = this.bitcoinCash ?
			transactionFeesSatoshi.bitcoinCash :
			transactionFeesSatoshi.bitcoin;

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
				new this.bitcore.BitcorePrivateKey(
					options.key,
					'livenet'
				).toBuffer() :
			options.key instanceof Uint8Array ?
				options.key :
				undefined;

		if (key !== undefined) {
			this.key = this.bitcore.BitcorePrivateKey.fromObject({
				bn: key,
				compressed: !options.uncompressedPublicKey,
				network: 'livenet'
			});
		}
		else if (!options.address) {
			this.key = new this.bitcore.BitcorePrivateKey(undefined, 'livenet');
		}

		this.isReadOnly = this.key === undefined;
		this.address = this.isReadOnly ?
			options.address :
			this.key.toAddress().toString();

		this.originatingTransactions = {};
		this.subjects = {};

		if (!this.bitcore.address.isValid(this.address)) {
			if (
				this.bitcoinCash &&
				bitcore.bitcoin.address.isValid(this.address)
			) {
				this.address = bitcore.bitcoinCash.address
					.fromPublicKeyHash(
						bitcore.bitcoin.address.fromString(this.address)
							.hashBuffer
					)
					.toString();
			}
			else {
				throw new Error(`Invalid Address: ${this.address}.`);
			}
		}
	}

	_friendlyTransaction (transaction, exchangeRate) {
		const senderAddresses = {};
		const recipientAddresses = {};

		const valueIn = transaction.inputs
			.map(o => o.value)
			.reduce((a, b) => a + b, 0);

		const valueOut = transaction.outputs
			.map(o => o.value)
			.reduce((a, b) => a + b, 0);

		const transactionData = {
			amount: undefined,
			valueInLocal: valueIn * exchangeRate,
			valueOutLocal: valueOut * exchangeRate,
			wasSentByMe: false
		};

		transactionData.amount = transactionData.valueOutLocal;

		for (const vin of transaction.inputs) {
			transactionData.wasSentByMe =
				transactionData.wasSentByMe || vin.address === this.address;

			vin.valueLocal = vin.value * exchangeRate;

			senderAddresses[vin.address] = true;
		}

		for (const vout of transaction.outputs) {
			vout.valueLocal = vout.value * exchangeRate;

			if (vout.address) {
				if (senderAddresses[vout.address]) {
					transactionData.amount -= vout.valueLocal;
				}
				else {
					recipientAddresses[vout.address] = true;
				}
			}
		}

		return {
			amount: parseFloat(
				(transactionData.amount / satoshiConversion).toFixed(8)
			),
			baseTransaction: transaction,
			id: transaction.txid,
			isConfirmed: !transaction.rbf,
			recipients: Object.keys(recipientAddresses),
			senders: Object.keys(senderAddresses),
			timestamp: transaction.time * 1000,
			wasSentByMe: transactionData.wasSentByMe
		};
	}

	async _friendlyTransactions (transactions) {
		const [txs, exchangeRates] = await Promise.all([
			transactions,
			this._getExchangeRates()
		]);

		const exchangeRate = exchangeRates[this.localCurrency];

		return (txs || []).map(tx =>
			this._friendlyTransaction(tx, exchangeRate)
		);
	}

	async _getExchangeRates () {
		return this.localCurrency === 'BTC' ?
			{BTC: 1} :
			getExchangeRates(this.bitcoinCash);
	}

	_watchTransactions () {
		const subjectID = `_watchTransactions ${this.address}`;

		if (!this.subjects[subjectID]) {
			const subject = new Subject();
			this.subjects[subjectID] = subject;

			if (this.bitcoinCash) {
				return subject;
			}

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
			blockchainAPIRequest(
				this.bitcoinCash,
				`address/${this.address}/unspent`
			).catch(() => [])
		]);

		const utxos = (unspentResponse || []).map(o => ({
			outputIndex: o.index,
			satoshis: o.value,
			scriptPubKey: o.pkscript,
			txid: o.txid
		}));

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
				return new this.bitcore.BitcoreTransaction()
					.from(
						utxos.map(
							utxo =>
								new this.bitcore.BitcoreTransaction.UnspentOutput(
									utxo
								)
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
					.fee(this.transactionFeeSatoshi)
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
			blockchainAPIRequest(
				this.bitcoinCash,
				`address/${this.address}/balance`
			),
			this._getExchangeRates()
		]);

		let balance = 0;
		try {
			balance = balanceResponse.confirmed / satoshiConversion;
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
			blockchainAPIRequest(
				this.bitcoinCash,
				`address/${this.address}/transactions/full`
			)
		);
	}

	async send (recipientAddress, amount) {
		const transaction = await this.createTransaction(
			recipientAddress,
			amount
		);

		const txid = transaction.id;
		this.originatingTransactions[txid] = true;

		const txdata = transaction.serialize();

		if (this.bitcoinCash) {
			return request(
				`https://rest.bitcoin.com/v2/rawtransactions/sendRawTransaction/${txdata}`
			).then(async o => o.text());
		}

		const formData = new FormData();
		formData.append('tx', txdata);

		return request('https://blockchain.info/pushtx', {
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
									this.bitcoinCash,
									`transactions/${txid}`
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
		bitcore.bitcoin.BitcoreTransaction.DUST_AMOUNT / satoshiConversion,
	setBlockchainAPIKey,
	transactionFees,
	transactionFeesSatoshi,
	Wallet
};

simplebtc.simplebtc = simplebtc;
module.exports = simplebtc;
