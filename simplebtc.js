var isNode =
	typeof process === 'object' &&
	typeof require === 'function' &&
	typeof window !== 'object' &&
	typeof importScripts !== 'function';

var rootScope = isNode ? global : self;

var BitcorePrivateKey = require('bitcore-lib/lib/privatekey');
var BitcoreTransaction = require('bitcore-lib/lib/transaction');
var FormData = require('form-data');
var {ReplaySubject, Subject} = require('rxjs');
var {map, mergeMap} = require('rxjs/operators');

var fetch =
	typeof rootScope.fetch === 'function' ?
		rootScope.fetch :
	isNode ?
		eval('require')('node-fetch') :
		require('whatwg-fetch');

/*
var storage		= typeof rootScope.localStorage === 'object' ? localStorage : (function () {
	var nodePersist	= eval('require')('node-persist');
	nodePersist.initSync();
	return nodePersist;
})();
*/

var locks = {};

function lock (id, f) {
	if (!locks[id]) {
		locks[id] = Promise.resolve();
	}

	locks[id] = locks[id]
		.catch(function () {})
		.then(function () {
			return f();
		});

	return locks[id];
}

var satoshiConversion = 100000000;
var transactionFee = 5430;

var blockchainApiURL = 'https://blockchain.info/';
var blockchainWebSocketURL = 'wss://ws.blockchain.info/inv';

function blockchainAPI (url, params) {
	params = params || {};
	params.cors = true;

	return (
		blockchainApiURL +
		url +
		'?' +
		Object.keys(params)
			.map(k => k + '=' + params[k])
			.join('&')
	);
}

function blockchainAPIRequest (url, params) {
	return lock('blockchainAPIRequest', function () {
		return fetch(blockchainAPI(url, params));
	}).then(function (o) {
		return o.json();
	});
}

function getExchangeRates () {
	return blockchainAPIRequest('ticker').then(function (o) {
		for (var k in o) {
			o[k] = o[k].last;
		}

		o.BTC = 1;

		return o;
	});
}

function friendlyTransaction (_this, transaction, exchangeRate) {
	var senderAddresses = {};
	var recipientAddresses = {};

	var valueIn = transaction.inputs
		.map(function (o) {
			return o.prev_out.value;
		})
		.reduce(function (a, b) {
			return a + b;
		});

	var valueOut = transaction.out
		.map(function (o) {
			return o.value;
		})
		.reduce(function (a, b) {
			return a + b;
		});

	var transactionData = {
		amount: undefined,
		valueInLocal: valueIn * exchangeRate,
		valueOutLocal: valueOut * exchangeRate,
		wasSentByMe: false
	};

	transactionData.amount = transactionData.valueOutLocal;

	for (var j = 0; j < transaction.inputs.length; ++j) {
		var vin = transaction.inputs[j].prev_out;

		transactionData.wasSentByMe =
			transactionData.wasSentByMe || vin.addr === _this.address;

		vin.valueLocal = vin.value * exchangeRate;

		senderAddresses[vin.addr] = true;
	}

	for (var j = 0; j < transaction.out.length; ++j) {
		var vout = transaction.out[j];

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
			(transactionData.amount / satoshiConversion).toFixed(4)
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

var Wallet = function (options) {
	options = options || {};

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
};

Wallet.prototype._getExchangeRates = function () {
	return this.localCurrency === 'BTC' ?
		Promise.resolve({BTC: 1}) :
		getExchangeRates();
};

Wallet.prototype._friendlyTransactions = function (transactions) {
	var _this = this;

	return Promise.all([transactions, _this._getExchangeRates()]).then(
		function (results) {
			var txs = results[0].txs || [];
			var exchangeRate = results[1][_this.localCurrency];

			return txs.map(function (tx) {
				return friendlyTransaction(_this, tx, exchangeRate);
			});
		}
	);
};

Wallet.prototype._watchTransactions = function () {
	var _this = this;

	var subjectID = '_watchTransactions ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID] = new Subject();

		var socket = new WebSocket(blockchainWebSocketURL);

		socket.onopen = function () {
			socket.send(JSON.stringify({op: 'addr_sub', addr: _this.address}));
		};

		socket.onmessage = function (msg) {
			var txid;
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
};

Wallet.prototype.getBalance = function () {
	var _this = this;

	return Promise.all([
		blockchainAPIRequest('balance', {active: _this.address}),
		_this._getExchangeRates()
	]).then(function (results) {
		var balance = 0;
		try {
			balance =
				results[0][_this.address].final_balance / satoshiConversion;
		}
		catch (_) {}

		var exchangeRates = results[1];

		return {
			_exchangeRates: exchangeRates,
			btc: balance,
			local: parseFloat(
				(balance * (exchangeRates[_this.localCurrency] || 0)).toFixed(2)
			)
		};
	});
};

Wallet.prototype.getTransactionHistory = function () {
	var _this = this;

	return _this._friendlyTransactions(
		blockchainAPIRequest('rawaddr/' + _this.address)
	);
};

Wallet.prototype.send = function (recipientAddress, amount) {
	var _this = this;

	if (_this.isReadOnly) {
		return Promise.reject(new Error('Read-only wallet'));
	}

	return Promise.all([
		_this.getBalance(),
		blockchainAPIRequest('unspent', {active: _this.address})
	]).then(function (results) {
		var balance = results[0];

		var utxos = ((results[1] || {}).unspent_outputs || []).map(function (
			o
		) {
			return {
				outputIndex: o.tx_output_n,
				satoshis: o.value,
				scriptPubKey: o.script,
				txid: o.tx_hash_big_endian
			};
		});

		amount = amount / balance._exchangeRates[_this.localCurrency];

		if (amount > balance.btc) {
			throw new Error('Insufficient funds');
		}

		for (var i = 0; i < utxos.length; ++i) {
			var utxo = utxos[i];
			if (
				_this.originatingTransactions[utxo.txid] &&
				!utxo.confirmations
			) {
				utxo.confirmations = 1;
			}
		}

		var transaction = (function createBitcoreTransaction (retries) {
			try {
				return new BitcoreTransaction()
					.from(
						utxos.map(function (utxo) {
							return new BitcoreTransaction.UnspentOutput(utxo);
						})
					)
					.to(
						recipientAddress.address ?
							recipientAddress.address :
						recipientAddress.getAddress ?
							recipientAddress.getAddress().toString() :
							recipientAddress,
						Math.floor(amount * satoshiConversion)
					)
					.fee(transactionFee)
					.sign(_this.key);
			}
			catch (e) {
				if (
					retries < 100 &&
					e.message.indexOf('totalNeededAmount') > -1
				) {
					amount -= 0.000005;
					return createBitcoreTransaction(retries + 1);
				}
				else {
					throw e;
				}
			}
		})(0);

		console.warn({
			transaction,
			utxos
		});

		var txid = transaction.id;
		_this.originatingTransactions[txid] = true;

		var formData = new FormData();
		formData.append('tx', transaction.serialize());

		return fetch(blockchainAPI('pushtx'), {
			body: formData,
			method: 'POST'
		})
			.then(function (o) {
				return o.text();
			})
			.then(o => {
				console.warn(o);
				debugger;
				return o;
			});
	});
};

Wallet.prototype.watchNewTransactions = function (shouldIncludeUnconfirmed) {
	if (shouldIncludeUnconfirmed === undefined) {
		shouldIncludeUnconfirmed = true;
	}

	var _this = this;

	var subjectID = 'watchNewTransactions ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID] = _this._watchTransactions().pipe(
			mergeMap(function (txid) {
				return lock(subjectID, function () {
					return _this
						._friendlyTransactions(
							blockchainAPIRequest('rawtx/' + txid).then(
								function (o) {
									return [o];
								}
							)
						)
						.then(function (newTransaction) {
							return newTransaction[0];
						});
				});
			})
		);
	}

	return shouldIncludeUnconfirmed ?
		_this.subjects[subjectID] :
		_this.subjects[subjectID].pipe(
			map(function (transactions) {
				return transactions.filter(function (transaction) {
					return transaction.isConfirmed;
				});
			})
		);
};

Wallet.prototype.watchTransactionHistory = function (
	shouldIncludeUnconfirmed
) {
	if (shouldIncludeUnconfirmed === undefined) {
		shouldIncludeUnconfirmed = true;
	}

	var _this = this;

	var subjectID = 'watchTransactionHistory ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID] = new ReplaySubject(1);

		_this.getTransactionHistory().then(function (transactions) {
			_this.subjects[subjectID].next(transactions);

			_this
				._watchTransactions()
				.pipe(
					mergeMap(function () {
						return lock(subjectID, function () {
							return _this.getTransactionHistory();
						});
					})
				)
				.subscribe(_this.subjects[subjectID]);
		});
	}

	return shouldIncludeUnconfirmed ?
		_this.subjects[subjectID] :
		_this.subjects[subjectID].pipe(
			map(function (transactions) {
				return transactions.filter(function (transaction) {
					return transaction.isConfirmed;
				});
			})
		);
};

var simplebtc = {
	getExchangeRates: getExchangeRates,
	transactionFee: transactionFee / satoshiConversion,
	Wallet: Wallet
};

simplebtc.simplebtc = simplebtc;
module.exports = simplebtc;
