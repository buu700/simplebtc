const isNode =
	typeof process === 'object' &&
	typeof require === 'function' &&
	typeof window !== 'object' &&
	typeof importScripts !== 'function';

const rootScope = isNode ? global : self;

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

const locks = {};

function lock (id, f)  {
	if (!locks[id]) {
		locks[id] = Promise.resolve();
	}

	locks[id] = locks[id].catch(() => {}).then(() => f());

	return locks[id];
}

function request (url, opts)  {
	let retries = 0;

	return lock('request', () => fetch(url, opts))
		.then(o => {
			if (o.status !== 200) {
				throw new Error(
					`Request failure: status ${o.status.toString()}`
				);
			}

			return o;
		})
		.catch(err => {
			if (retries > 10) {
				throw err;
			}
			++retries;

			return new Promise(resolve => {
				setTimeout(resolve, 250);
			}).then(() => request(url, opts));
		});
}

const satoshiConversion = 100000000;
const transactionFee = 5430;

const blockchainApiURL = 'https://blockchain.info/';
const blockchainWebSocketURL = 'wss://ws.blockchain.info/inv';

function blockchainAPI (url, params = {})  {
	if (params.cors !== false) {
		params.cors = true;
	}

	return `${blockchainApiURL + url}?${Object.keys(params)
		.map(k => `${k}=${params[k]}`)
		.join('&')}`;
}

function blockchainAPIRequest (url, params)  {
	return request(blockchainAPI(url, params)).then(o => o.json());
}

function getExchangeRates ()  {
	return blockchainAPIRequest('ticker').then(o => {
		for (const k in o) {
			o[k] = o[k].last;
		}

		o.BTC = 1;

		return o;
	});
}

function friendlyTransaction (_this, transaction, exchangeRate)  {
	const senderAddresses = {};
	const recipientAddresses = {};

	const valueIn = transaction.inputs
		.map(o => o.prev_out.value)
		.reduce((a, b) => a + b);

	const valueOut = transaction.out.map(o => o.value).reduce((a, b) => a + b);

	const transactionData = {
		amount: undefined,
		valueInLocal: valueIn * exchangeRate,
		valueOutLocal: valueOut * exchangeRate,
		wasSentByMe: false
	};

	transactionData.amount = transactionData.valueOutLocal;

	for (const vin of transaction.inputs.map(o => o.prev_out)) {
		transactionData.wasSentByMe =
			transactionData.wasSentByMe || vin.addr === _this.address;

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

class Wallet {
	constructor (options = {}) {
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

		if (options.key) {
			this.key =
				typeof options.key === 'string' ?
					new BitcorePrivateKey(options.key, 'livenet') :
					BitcorePrivateKey.fromObject({
						bn: options.key,
						compressed: true,
						network: 'livenet'
					});
		}
		else if (!options.address) {
			this.key = new BitcorePrivateKey(undefined, 'livenet');
		}

		this.isReadOnly = !this.key;
		this.address = this.isReadOnly ?
			options.address :
			this.key.toAddress().toString();

		this.originatingTransactions = {};
		this.subjects = {};
	}

	_getExchangeRates ()  {
		return this.localCurrency === 'BTC' ?
			Promise.resolve({BTC: 1}) :
			getExchangeRates();
	}

	_friendlyTransactions (transactions)  {
		const _this = this;

		return Promise.all([transactions, _this._getExchangeRates()]).then(
			results => {
				const txs = results[0].txs || [];
				const exchangeRate = results[1][_this.localCurrency];

				return txs.map(tx =>
					friendlyTransaction(_this, tx, exchangeRate)
				);
			}
		);
	}

	_watchTransactions ()  {
		const _this = this;

		const subjectID = `_watchTransactions ${_this.address}`;

		if (!_this.subjects[subjectID]) {
			_this.subjects[subjectID] = new Subject();

			const socket = new WebSocket(blockchainWebSocketURL);

			socket.onopen = () => {
				socket.send(
					JSON.stringify({op: 'addr_sub', addr: _this.address})
				);
			};

			socket.onmessage = msg => {
				let txid;
				try {
					txid = JSON.parse(msg.data).x.hash;
				}
				catch (_) {}

				if (txid) {
					_this.subjects[subjectID].next(JSON.parse(msg.data).x.hash);
				}
			};
		}

		return _this.subjects[subjectID];
	}

	createTransaction (recipientAddress, amount)  {
		const _this = this;

		if (_this.isReadOnly) {
			return Promise.reject(new Error('Read-only wallet'));
		}

		return Promise.all([
			_this.getBalance(),
			blockchainAPIRequest('unspent', {active: _this.address}).catch(
				() => ({
					unspent_outputs: []
				})
			)
		]).then(results => {
			const balance = results[0];

			const utxos = ((results[1] || {}).unspent_outputs || []).map(o => ({
				outputIndex: o.tx_output_n,
				satoshis: o.value,
				scriptPubKey: o.script,
				txid: o.tx_hash_big_endian
			}));

			amount = amount / balance._exchangeRates[_this.localCurrency];

			if (amount > balance.btc) {
				throw new Error('Insufficient funds');
			}

			for (const utxo of utxos) {
				if (
					_this.originatingTransactions[utxo.txid] &&
					!utxo.confirmations
				) {
					utxo.confirmations = 1;
				}
			}

			return (function createBitcoreTransaction (retries)  {
				try {
					return new BitcoreTransaction()
						.from(
							utxos.map(
								utxo =>
									new BitcoreTransaction.UnspentOutput(utxo)
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
						.change(_this.address)
						.fee(transactionFee)
						.sign(_this.key);
				}
				catch (e) {
					if (
						retries < 100 &&
						e.message.includes('totalNeededAmount')
					) {
						amount -= 0.000005;
						return createBitcoreTransaction(retries + 1);
					}
					else {
						throw e;
					}
				}
			})(0);
		});
	}

	getBalance ()  {
		const _this = this;

		return Promise.all([
			blockchainAPIRequest('balance', {active: _this.address}),
			_this._getExchangeRates()
		]).then(results => {
			let balance = 0;
			try {
				balance =
					results[0][_this.address].final_balance / satoshiConversion;
			}
			catch (_) {}

			const exchangeRates = results[1];

			return {
				_exchangeRates: exchangeRates,
				btc: balance,
				local: parseFloat(
					(
						balance * (exchangeRates[_this.localCurrency] || 0)
					).toFixed(2)
				)
			};
		});
	}

	getTransactionHistory ()  {
		const _this = this;

		return _this._friendlyTransactions(
			blockchainAPIRequest(`rawaddr/${_this.address}`)
		);
	}

	send (recipientAddress, amount)  {
		const _this = this;

		return _this
			.createTransaction(recipientAddress, amount)
			.then(transaction => {
				const txid = transaction.id;
				_this.originatingTransactions[txid] = true;

				const formData = new FormData();
				formData.append('tx', transaction.serialize());

				return request(blockchainAPI('pushtx'), {
					body: formData,
					method: 'POST'
				}).then(o => o.text());
			});
	}

	watchNewTransactions (shouldIncludeUnconfirmed)  {
		if (shouldIncludeUnconfirmed === undefined) {
			shouldIncludeUnconfirmed = true;
		}

		const _this = this;

		const subjectID = `watchNewTransactions ${_this.address}`;

		if (!_this.subjects[subjectID]) {
			_this.subjects[subjectID] = _this
				._watchTransactions()
				.pipe(
					mergeMap(txid =>
						lock(subjectID, () =>
							_this
								._friendlyTransactions(
									blockchainAPIRequest(
										`rawtx/${txid}`
									).then(o => [o])
								)
								.then(newTransaction => newTransaction[0])
						)
					)
				);
		}

		return shouldIncludeUnconfirmed ?
			_this.subjects[subjectID] :
			_this.subjects[subjectID].pipe(
				map(transactions =>
					transactions.filter(transaction => transaction.isConfirmed)
				)
			);
	}

	watchTransactionHistory (shouldIncludeUnconfirmed)  {
		if (shouldIncludeUnconfirmed === undefined) {
			shouldIncludeUnconfirmed = true;
		}

		const _this = this;

		const subjectID = `watchTransactionHistory ${_this.address}`;

		if (!_this.subjects[subjectID]) {
			_this.subjects[subjectID] = new ReplaySubject(1);

			_this.getTransactionHistory().then(transactions => {
				_this.subjects[subjectID].next(transactions);

				_this
					._watchTransactions()
					.pipe(
						mergeMap(() =>
							lock(subjectID, () => _this.getTransactionHistory())
						)
					)
					.subscribe(_this.subjects[subjectID]);
			});
		}

		return shouldIncludeUnconfirmed ?
			_this.subjects[subjectID] :
			_this.subjects[subjectID].pipe(
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
	transactionFee: transactionFee / satoshiConversion,
	Wallet
};

simplebtc.simplebtc = simplebtc;
module.exports = simplebtc;
