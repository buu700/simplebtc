var isNode		=
	typeof process === 'object' &&
	typeof require === 'function' &&
	typeof window !== 'object' &&
	typeof importScripts !== 'function'
;

var rootScope	= isNode ? global : self;


var BitcorePrivateKey	= require('bitcore-lib/lib/privatekey');
var BitcoreTransaction	= require('bitcore-lib/lib/transaction');
var FormData			= require('form-data');
var {map}				= require('rxjs/operators/map');
var {mergeMap}			= require('rxjs/operators/mergeMap');
var {ReplaySubject}		= require('rxjs/ReplaySubject');
var {Subject}			= require('rxjs/Subject');
var io					= require('socket.io-client');

var fetch		= typeof rootScope.fetch === 'function' ? rootScope.fetch : isNode ?
	eval('require')('node-fetch') :
	require('whatwg-fetch')
;

/*
var storage		= typeof rootScope.localStorage === 'object' ? localStorage : (function () {
	var nodePersist	= eval('require')('node-persist');
	nodePersist.initSync();
	return nodePersist;
})();
*/


var locks	= {};

function lock (id, f) {
	if (!locks[id]) {
		locks[id]	= Promise.resolve();
	}

	locks[id]	= locks[id].catch(function () {}).then(function () {
		return f();
	});

	return locks[id];
}


var Networks	= {
	Mainnet: 0,
	Testnet: 1
};

function getExchangeRates () {
	return fetch('https://blockchain.info/ticker?cors=true').then(function (o) {
		return o.json();
	}).then(function(o) {
		for (var k in o) {
			o[k]	= o[k].last;
		}

		o.BTC	= 1;

		return o;
	});
}

function friendlyTransaction (_this, transaction, exchangeRate) {
	var senderAddresses		= {};
	var recipientAddresses	= {};

	var transactionData	= {
		amount: undefined,
		valueInLocal: transaction.valueIn * exchangeRate,
		valueOutLocal: transaction.valueOut * exchangeRate,
		wasSentByMe: false
	};

	transactionData.amount	= transactionData.valueOutLocal;

	for (var j = 0 ; j < transaction.vin.length ; ++j) {
		var vin	= transaction.vin[j];

		transactionData.wasSentByMe	= transactionData.wasSentByMe || vin.addr === _this.address;
		vin.valueLocal				= vin.value * exchangeRate;

		senderAddresses[vin.addr]	= true;
	}

	for (var j = 0 ; j < transaction.vout.length ; ++j) {
		var vout	= transaction.vout[j];

		vout.valueLocal	= parseFloat(vout.value, 10) * exchangeRate;

		for (var k = 0 ; k < vout.scriptPubKey.addresses.length ; ++k) {
			var recipientAddress	= vout.scriptPubKey.addresses[k];

			if (senderAddresses[recipientAddress]) {
				transactionData.amount	-= vout.valueLocal;
			}
			else {
				recipientAddresses[recipientAddress]	= true;
			}
		}
	}

	return {
		amount: parseFloat(transactionData.amount.toFixed(2)),
		baseTransaction: transaction,
		id: transaction.txid,
		isConfirmed: (transaction.confirmations || 0) >= 6,
		recipients: Object.keys(recipientAddresses),
		senders: Object.keys(senderAddresses),
		timestamp: transaction.time * 1000,
		wasSentByMe: transactionData.wasSentByMe
	};
}


var Wallet	= function (options) {
	options	= options || {};

	if (options instanceof Wallet) {
		this.address					= options.address;
		this.insightBaseURL				= options.insightBaseURL;
		this.isReadOnly					= options.isReadOnly;
		this.localCurrency				= options.localCurrency;
		this.key						= options.key;
		this.network					= options.network;
		this.originatingTransactions	= options.originatingTransactions;
		this.subjects					= {};

		return;
	}

	this.localCurrency	= options.localCurrency || 'BTC';
	this.network		= options.network || Networks.Mainnet;

	this.insightBaseURL	= options.insightBaseURL || (
		this.network === Networks.Mainnet ?
			'https://insight.bitpay.com/api' :
			'https://test-insight.bitpay.com/api'
	);

	var network			= this.network === Networks.Testnet ? 'testnet' : 'livenet';

	if (options.key) {
		this.key		= typeof options.key === 'string' ?
			new BitcorePrivateKey(options.key, network) :
			BitcorePrivateKey.fromObject({
				bn: options.key,
				compressed: true,
				network: network
			})
		;
	}
	else if (!options.address) {
		this.key		= new BitcorePrivateKey(undefined, network);
	}

	this.isReadOnly		= !this.key;
	this.address		= this.isReadOnly ?
		options.address :
		this.key.toAddress().toString()
	;

	this.originatingTransactions	= {};
	this.subjects					= {};
};

Wallet.prototype._getExchangeRates	= function () {
	return this.localCurrency === 'BTC' ? Promise.resolve({BTC: 1}) : getExchangeRates();
};

Wallet.prototype._friendlyTransactions	= function (transactions) {
	var _this	= this;

	return Promise.all([
		transactions,
		_this._getExchangeRates()
	]).then(function (results) {
		var txs				= results[0].txs || [];
		var exchangeRate	= results[1][_this.localCurrency];

		return txs.map(function (tx) { return friendlyTransaction(_this, tx, exchangeRate); });
	});
}

Wallet.prototype._watchTransactions	= function () {
	var _this	= this;

	var subjectID	= '_watchTransactions ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID]	= new Subject();

		var socket	= io(_this.insightBaseURL);

		socket.on('connect', function () {
			socket.emit('subscribe', 'inv');
		});

		socket.on(_this.address, function (tx) {
			_this.subjects[subjectID].next(tx);
		});
	}

	return _this.subjects[subjectID];
};

Wallet.prototype.getBalance	= function () {
	var _this	= this;

	return Promise.all([
		fetch(
			_this.insightBaseURL + '/addr/' + _this.address + '/balance'
		).then(function (o) {
			return o.text();
		}),
		_this._getExchangeRates()
	]).then(function (results) {
		var balance			= Number.parseInt(results[0] || '0', 10) / 100000000;
		var exchangeRates	= results[1];

		return {
			_exchangeRates: exchangeRates,
			btc: balance,
			local: parseFloat((balance * (exchangeRates[_this.localCurrency] || 0)).toFixed(2))
		};
	});
};

Wallet.prototype.getTransactionHistory	= function () {
	var _this	= this;

	return _this._friendlyTransactions(fetch(
		_this.insightBaseURL + '/txs/?address=' + _this.address
	).then(function (o) {
		return o.json();
	}));
};

Wallet.prototype.send	= function (recipientAddress, amount) {
	var _this	= this;

	if (_this.isReadOnly) {
		return Promise.reject(new Error('Read-only wallet'));
	}

	return Promise.all([
		_this.getBalance(),
		fetch(
			_this.insightBaseURL + '/addr/' + _this.address + '/utxo?noCache=1'
		).then(function (o) {
			return o.json();
		})
	]).then(function (results) {
		var balance	= results[0];
		var utxo	= results[1];

		amount	= amount / balance._exchangeRates[_this.localCurrency];

		if (amount > balance.btc) {
			throw new Error('Insufficient funds');
		}
		else if (balance.btc - amount < 0.0002) {
			amount	= balance.btc;
		}

		for (var i = 0 ; i < utxo.length ; ++i) {
			var txout	= utxo[i];
			if (_this.originatingTransactions[txout.txid] && !txout.confirmations) {
				txout.confirmations	= 1;
			}
		}

		var transaction	= (function createBitcoreTransaction (retries) {
			try {
				return new BitcoreTransaction().
					from(utxo).
					to(
						recipientAddress.address ?
							recipientAddress.address :
						recipientAddress.getAddress ?
							recipientAddress.getAddress().toString() :
							recipientAddress
						,
						amount
					).
					sign(_this.key)
				;
			}
			catch (e) {
				if (retries < 100 && e.message.indexOf('totalNeededAmount') > -1) {
					amount	-= 0.00005;
					return createBitcoreTransaction(retries + 1);
				}
				else {
					throw e;
				}
			}
		})(0);

		var txid	= transaction.id;
		_this.originatingTransactions[txid]	= true;
		
		var formData	= new FormData();
		formData.append('rawtx', transaction.serialize());

		return fetch(_this.insightBaseURL + '/tx/send', {
			body: formData,
			method: 'POST'
		}).then(function (o) {
			return o.text();
		});
	});
};

Wallet.prototype.watchNewTransactions	= function (shouldIncludeUnconfirmed) {
	if (shouldIncludeUnconfirmed === undefined) {
		shouldIncludeUnconfirmed	= true;
	}

	var _this	= this;

	var subjectID	= 'watchNewTransactions ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID]	= _this._watchTransactions().pipe(mergeMap(function (tx) {
			return lock(subjectID, function () {
				return _this._friendlyTransactions(fetch(
					_this.insightBaseURL + '/tx/' + tx.txid
				).then(function (o) {
					return o.json();
				}).then(function (o) {
					return [o];
				})).then(function (newTransaction) {
					return newTransaction[0];
				});
			});
		}));
	}

	return shouldIncludeUnconfirmed ?
		_this.subjects[subjectID] :
		_this.subjects[subjectID].pipe(map(function (transactions) {
			return transactions.filter(function (transaction) {
				return transaction.isConfirmed;
			});
		}))
	;
};

Wallet.prototype.watchTransactionHistory	= function (shouldIncludeUnconfirmed) {
	if (shouldIncludeUnconfirmed === undefined) {
		shouldIncludeUnconfirmed	= true;
	}

	var _this	= this;

	var subjectID	= 'watchTransactionHistory ' + _this.address;

	if (!_this.subjects[subjectID]) {
		_this.subjects[subjectID]	= new ReplaySubject(1);

		_this.getTransactionHistory().then(function (transactions) {
			_this.subjects[subjectID].next(transactions);

			_this._watchTransactions().pipe(mergeMap(function (tx) {
				return lock(subjectID, function () {
					return _this.getTransactionHistory();
				});
			})).subscribe(
				_this.subjects[subjectID]
			);
		});
	}

	return shouldIncludeUnconfirmed ?
		_this.subjects[subjectID] :
		_this.subjects[subjectID].pipe(map(function (transactions) {
			return transactions.filter(function (transaction) {
				return transaction.isConfirmed;
			});
		}))
	;
};


var simplebtc	= {
	getExchangeRates: getExchangeRates,
	Networks: Networks,
	Wallet: Wallet
};


simplebtc.simplebtc	= simplebtc;
module.exports		= simplebtc;
