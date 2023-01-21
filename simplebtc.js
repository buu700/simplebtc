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

const BCHJS = require('@psf/bch-js');
const FormData = require('form-data');
const memoize = require('lodash/memoize');
const {Observable, ReplaySubject, Subject} = require('rxjs');
const {map, mergeMap} = require('rxjs/operators');

const fetch =
	typeof rootScope.fetch === 'function' ?
		rootScope.fetch :
	isNode ?
		async (url, options) =>
			(await eval('import("node-fetch")')).default(url, options) :
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

const request = async (url, opts, delay = 0, maxRetries = 2, retries = 0) =>
	new Promise(async (resolve, reject) =>
		lock(`request:${url.split('/')[2]}`, async () => {
			try {
				const o = await fetch(url, opts);

				if (o.status !== 200) {
					throw new Error(
						`Request failure: status ${o.status.toString()}`
					);
				}

				resolve(o);
				return;
			}
			catch (err) {
				if (retries >= maxRetries) {
					reject(err);
					return;
				}
			}
			finally {
				await sleep(delay);
			}

			await sleep(1000);
			resolve(request(url, opts, delay, maxRetries, retries + 1));
		})
	);

const bitcoinCashAddresses = {};

const getBitcoinCashAddress = legacyAddress => {
	if (!bitcoinCashAddresses[legacyAddress]) {
		bitcoinCashAddresses[legacyAddress] = bitcore.bitcoinCash.address
			.fromPublicKeyHash(
				bitcore.bitcoin.address.fromString(legacyAddress).hashBuffer
			)
			.toString();
	}

	return bitcoinCashAddresses[legacyAddress];
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
const blockchainAPIURL = 'https://blockchain.info/';
const blockchainWebSocketURL = 'wss://ws.blockchain.info/inv';

let fullStackCashAPITokenTier = 0;
const fullStackCashRequestsPerMinute = {
	0: 10,
	1: 100,
	2: 250
};

const blockchainAPI = (url, params = {}) => {
	if (params.cors !== false) {
		params.cors = true;
	}

	if (blockchainAPIKey !== undefined) {
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
		/* blockchainAPIKey ? 0 : 10000 */
		10000
	).then(async o => o.json());
};

let bchjs = new BCHJS();

const bchjsLock = async f =>
	lock(
		'bchjs',
		f,
		Math.ceil(
			60000 / fullStackCashRequestsPerMinute[fullStackCashAPITokenTier]
		)
	);

const getExchangeRatesInternal = async bitcoinCash => {
	const [o, conversionRate] = await Promise.all([
		request('https://blockchain.info/ticker').then(async o => o.json()),
		bitcoinCash ?
			(async () =>
				(
					await request(
						'https://api.coingecko.com/api/v3/exchange_rates'
					).then(o => o.json())
				).rates.bch.value)() :
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

const getExchangeRates = memoize(async (bitcoinCash = false) => {
	setTimeout(() => {
		getExchangeRates.cache.delete(bitcoinCash);
	}, 10000);

	return getExchangeRatesInternal(bitcoinCash);
});

const setBlockchainAPIKey = apiKey => {
	blockchainAPIKey = apiKey;
};

const setFullStackCashAPIToken = (apiToken, tier = 1) => {
	bchjs = new BCHJS({apiToken});
	fullStackCashAPITokenTier = tier;
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
			this.observables = {};

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
		this.observables = {};

		if (!this.bitcore.address.isValid(this.address)) {
			if (
				this.bitcoinCash &&
				bitcore.bitcoin.address.isValid(this.address)
			) {
				this.address = getBitcoinCashAddress(this.address);
			}
			else {
				throw new Error(`Invalid Address: ${this.address}.`);
			}
		}
	}

	async _friendlyTransaction (transaction, blockCount, exchangeRate) {
		if ('baseTransaction' in transaction) {
			return transaction;
		}

		const senderAddresses = {};
		const recipientAddresses = {};

		const inputs = this.bitcoinCash ?
			await Promise.all(
				transaction.vin.map(
					async o =>
						(
							await bchjsLock(async () =>
								bchjs.Electrumx.txData(o.txid)
							)
						).details.vout[o.vout]
				)
			) :
			transaction.inputs.map(o => o.prev_out);

		const outputs = this.bitcoinCash ? transaction.vout : transaction.out;

		const getValue = o =>
			this.bitcoinCash ?
				vin.value * satoshiConversion :
			typeof o.valueSat === 'number' ?
				o.valueSat :
			typeof o.value === 'string' ?
				parseFloat(o.value) * satoshiConversion :
				o.value;

		const valueIn = inputs.map(getValue).reduce((a, b) => a + b, 0);

		const valueOut = outputs.map(getValue).reduce((a, b) => a + b, 0);

		const transactionData = {
			amount: undefined,
			valueInLocal: valueIn * exchangeRate,
			valueOutLocal: valueOut * exchangeRate,
			wasSentByMe: false
		};

		transactionData.amount = transactionData.valueOutLocal;

		for (const vin of inputs) {
			const address = this.bitcoinCash ?
				vin.scriptPubKey.addresses?.[0] :
				vin.addr;

			const value = getValue(vin);

			transactionData.wasSentByMe =
				transactionData.wasSentByMe || address === this.address;

			vin.valueLocal = value * exchangeRate;

			senderAddresses[address] = true;
		}

		for (const vout of outputs) {
			const address = this.bitcoinCash ?
				vout.scriptPubKey.addresses?.[0] :
				vout.addr;

			const value = getValue(vout);

			vout.valueLocal = value * exchangeRate;

			if (address) {
				if (senderAddresses[address]) {
					transactionData.amount -= vout.valueLocal;
				}
				else {
					recipientAddresses[address] = true;
				}
			}
		}

		const confirmations = this.bitcoinCash ?
			transaction.confirmations || 0 :
			blockCount - (transaction.block_height || blockCount);

		const id = this.bitcoinCash ?
			transaction.txid :
			transaction.hash || transaction.txid;

		return {
			amount: parseFloat(
				(transactionData.amount / satoshiConversion).toFixed(8)
			),
			baseTransaction: transaction,
			id,
			isConfirmed: confirmations >= 6,
			recipients: Object.keys(recipientAddresses),
			senders: Object.keys(senderAddresses),
			timestamp: transaction.time * 1000,
			wasSentByMe: transactionData.wasSentByMe
		};
	}

	async _friendlyTransactions (transactions) {
		const [txs, blockCount, exchangeRates] = await Promise.all([
			this.bitcoinCash ?
				Promise.all(
					transactions.map(
						async ({tx_hash}) =>
							(
								await bchjsLock(async () =>
									bchjs.Electrumx.txData(tx_hash)
								)
							).details
					)
				) :
				transactions,
			this.bitcoinCash ?
				undefined :
				request(blockchainAPI('q/getblockcount'))
					.then(async o => o.text())
					.then(s => parseInt(s, 10)),
			this._getExchangeRates()
		]);

		const exchangeRate = exchangeRates[this.localCurrency];

		return Promise.all(
			txs.map(async tx =>
				this._friendlyTransaction(tx, blockCount, exchangeRate)
			)
		);
	}

	async _getExchangeRates () {
		return this.localCurrency === 'BTC' ? {BTC: 1} : getExchangeRates();
	}

	_watchTransactions () {
		const observableID = `_watchTransactions ${this.address}`;

		if (!this.observables[observableID]) {
			if (this.bitcoinCash) {
				this.observables[observableID] = new Observable(observer => {
					let alive = true;

					/* Workaround until we have an equivalent socket API */
					(async () => {
						let lastTransactionHistory;

						while (alive) {
							const transactionHistory =
								await this.getTransactionHistory();

							const delta = lastTransactionHistory ?
								transactionHistory.length -
								lastTransactionHistory.length :
								0;

							for (let i = 0; i < delta; ++i) {
								const o = transactionHistory[i];
								observer.next(() => o);
							}

							lastTransactionHistory = transactionHistory;
							await sleep(300000);
						}
					})();

					return () => {
						alive = false;
					};
				});
			}
			else {
				const subject = new Subject();
				this.observables[observableID] = subject;

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
						subject.next(
							async () =>
								(
									await this._friendlyTransactions(
										blockchainAPIRequest(
											`rawtx/${txid}`
										).then(o => [o])
									)
								)[0]
						);
					}
				};
			}
		}

		return this.observables[observableID];
	}

	async createTransaction (recipientAddress, amount) {
		if (this.isReadOnly) {
			throw new Error('Read-only wallet');
		}

		const [balance, utxos] = await Promise.all([
			this.getBalance(),
			this.bitcoinCash ?
				bchjsLock(async () => bchjs.Electrumx.utxo(this.address))
					.catch(() => undefined)
					.then(async unspentResponse => Promise.all(
							((unspentResponse || {}).utxos || []).map(
								async o => ({
									outputIndex: o.tx_pos,
									satoshis: o.value,
									scriptPubKey: (
											await bchjsLock(async () =>
												bchjs.Electrumx.txData(
													o.tx_hash
												)
											)
										).details.vout[o.tx_pos].scriptPubKey
											.hex,
									txid: o.tx_hash
								})
							)
						)) :
				blockchainAPIRequest('unspent', {active: this.address})
					.catch(() => undefined)
					.then(unspentResponse =>
						((unspentResponse || {}).unspent_outputs || []).map(
							o => ({
								outputIndex: o.tx_output_n,
								satoshis: o.value,
								scriptPubKey: o.script,
								txid: o.tx_hash_big_endian
							})
						)
					)
		]);

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
		const [balance, exchangeRates] = await Promise.all([
			this.bitcoinCash ?
				bchjsLock(async () => bchjs.Electrumx.balance(this.address))
					.catch(() => undefined)
					.then(
						detailsResponse =>
							(detailsResponse?.success &&
								detailsResponse.balance?.confirmed) ||
							0
					) :
				blockchainAPIRequest('balance', {active: this.address}).then(
					balanceResponse => {
						let n = 0;
						try {
							n =
								balanceResponse[this.address].final_balance /
								satoshiConversion;
						}
						catch (_) {}
						return n;
					}
				),
			this._getExchangeRates()
		]);

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
			this.bitcoinCash ?
				(
					await bchjsLock(async () =>
						bchjs.Electrumx.transactions(this.address)
					)
				)?.transactions ?? [] :
				(await blockchainAPIRequest(`rawaddr/${this.address}`))?.txs ??
					[]
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
			return JSON.stringify(
				await bchjsLock(async () => bchjs.Electrumx.broadcast(txdata))
			);
		}

		const formData = new FormData();
		formData.append('tx', txdata);

		return request(blockchainAPI('pushtx'), {
			body: formData,
			method: 'POST'
		}).then(async o => o.text());
	}

	watchNewTransactions (shouldIncludeUnconfirmed = true) {
		const observableID = `watchNewTransactions ${this.address}`;

		if (!this.observables[observableID]) {
			this.observables[observableID] = this._watchTransactions().pipe(
				mergeMap(async getTransaction =>
					lock(observableID, getTransaction)
				)
			);
		}

		return shouldIncludeUnconfirmed ?
			this.observables[observableID] :
			this.observables[observableID].pipe(
				map(transactions =>
					transactions.filter(transaction => transaction.isConfirmed)
				)
			);
	}

	watchTransactionHistory (shouldIncludeUnconfirmed = true) {
		const observableID = `watchTransactionHistory ${this.address}`;

		if (!this.observables[observableID]) {
			const subject = new ReplaySubject(1);
			this.observables[observableID] = subject;

			this.getTransactionHistory()
				.then(transactions => {
					subject.next(transactions);

					this._watchTransactions()
						.pipe(
							mergeMap(async () =>
								lock(observableID, async () =>
									this.getTransactionHistory()
								)
							)
						)
						.subscribe(subject);
				})
				.catch(err => {
					this.observables[observableID].error(err);
				});
		}

		return shouldIncludeUnconfirmed ?
			this.observables[observableID] :
			this.observables[observableID].pipe(
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
	setFullStackCashAPIToken,
	transactionFees,
	transactionFeesSatoshi,
	Wallet
};

simplebtc.simplebtc = simplebtc;
module.exports = simplebtc;
