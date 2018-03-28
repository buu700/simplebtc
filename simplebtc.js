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
var {ReplaySubject}		= require('rxjs/ReplaySubject');
var {Subject}			= require('rxjs/Subject');

var fetch		= typeof rootScope.fetch === 'function' ? rootScope.fetch : isNode ?
	eval('require')('node-fetch') :
	require('whatwg-fetch')
;

var WebSocket	= typeof rootScope.WebSocket === 'function' ? rootScope.WebSocket :
	eval('require')('ws')
;

/*
var storage		= typeof rootScope.localStorage === 'object' ? localStorage : (function () {
	var nodePersist	= eval('require')('node-persist');
	nodePersist.initSync();
	return nodePersist;
})();
*/


function getExchangeRates () {
	return fetch('https://blockchain.info/ticker?cors=true').then(function (o) {
		return o.json();
	}).then(function(o) {
		for (var k in o) {
			o[k]	= o[k].last;
		}

		o.BTC = 1;

		return o;
	});
}

function friendlyTransaction (transaction, exchangeRate) {
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
		timestamp: transaction.time ? transaction.time * 1000 : Date.now(),
		wasSentByMe: transactionData.wasSentByMe
	};
}


var Wallet	= function (options) {
	options	= options || {};

	if (options instanceof Wallet) {
		this.address					= options.address;
		this.isReadOnly					= options.isReadOnly;
		this.localCurrency				= options.localCurrency;
		this.key						= options.key;
		this.originatingTransactions	= options.originatingTransactions;
		this.subjects					= {};

		return;
	}

	this.localCurrency	= options.localCurrency || 'BTC';

	if (options.key) {
		this.key		= typeof options.key === 'string' ?
			BitcorePrivateKey.fromString(options.key) :
			BitcorePrivateKey.fromObject({
				bn: options.key,
				compressed: true,
				network: 'livenet'
			})
		;
	}
	else if (!options.address) {
		this.key		= new BitcorePrivateKey();
	}

	this.isReadOnly		= !this.key;
	this.address		= this.isReadOnly ?
		options.address :
		this.key.toAddress().toString()
	;

	this.originatingTransactions	= {};
	this.subjects					= {};
};

Wallet.prototype.getBalance	= function () {
	var _this	= this;

	return Promise.all([
		fetch(
			'https://blockchain.info/q/addressbalance/' + _this.address + '?cors=true'
		).then(function (o) {
			return o.text();
		}),
		getExchangeRates()
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

	return Promise.all([
		fetch(
			'https://insight.bitpay.com/api/txs/?address=' + _this.address
		).then(function (o) {
			return o.json();
		}),
		getExchangeRates()
	]).then(function (results) {
		var txs				= results[0].txs || [];
		var exchangeRate	= results[1][_this.localCurrency];

		return txs.map(function (tx) { return friendlyTransaction(tx, exchangeRate); });
	});
};

Wallet.prototype.send	= function (recipientAddress, amount) {
	var _this	= this;

	if (_this.isReadOnly) {
		return Promise.reject(new Error('Read-only wallet'));
	}

	return Promise.all([
		_this.getBalance(),
		fetch(
			'https://insight.bitpay.com/api/addr/' + _this.address + '/utxo?noCache=1'
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
		formData.append('tx', transaction.serialize());

		return fetch('https://blockchain.info/pushtx?cors=true', {
			body: formData,
			method: 'POST'
		}).then(function (o) {
			return o.text();
		});
	});
};

Wallet.prototype.watchNewTransactions	= function (shouldIncludeUnconfirmed) {
	var previousTransactions;
	var subject	= new Subject();

	this.watchTransactionHistory(shouldIncludeUnconfirmed).subscribe(function (transactions) {
		if (!previousTransactions) {
			previousTransactions	= transactions;
			return;
		}

		for (var i = 0 ; i < transactions.length ; ++i) {
			var transaction	= transactions[i].id;

			if (
				previousTransactions.length > 0 &&
				previousTransactions[0].id === transaction.id
			) {
				break;
			}

			subject.next(transaction);
		}

		previousTransactions	= transactions;
	});

	return subject;
};

Wallet.prototype.watchTransactionHistory	= function (shouldIncludeUnconfirmed) {
	if (shouldIncludeUnconfirmed === undefined) {
		shouldIncludeUnconfirmed	= true;
	}

	var _this	= this;

	if (!_this.subjects[_this.address]) {
		_this.subjects[_this.address]	= new ReplaySubject();

		_this.getTransactionHistory().then(function (transactions) {
			_this.subjects[_this.address].next(transactions);

			var ws	= new WebSocket('wss://ws.blockchain.info/inv');

			ws.on('open', function () {
				ws.send(JSON.stringify({op: 'addr_sub', addr: _this.address}));
			});

			ws.on('message', function () {
				_this.getTransactionHistory().then(function (wsTransactions) {
					_this.subjects[_this.address].next(wsTransactions);
				});
			});
		});
	}

	return shouldIncludeUnconfirmed ?
		_this.subjects[_this.address] :
		_this.subjects[_this.address].pipe(map(function (transactions) {
			return transactions.filter(function (transaction) {
				return transaction.isConfirmed;
			});
		}))
	;
};


var simplebtc	= {
	getExchangeRates: getExchangeRates,
	Wallet: Wallet
};


simplebtc.simplebtc	= simplebtc;
module.exports		= simplebtc;
