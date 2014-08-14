var Wallet;

(function () {


/*** XMLHttpRequest ***/

var XMLHttpRequest	= typeof window != 'undefined' ? window.XMLHttpRequest : null;
if (!XMLHttpRequest) {
	XMLHttpRequest	= require('xmlhttprequest').XMLHttpRequest;
}


/*** FormData ***/

var FormData	= typeof window != 'undefined' ? window.FormData : null;
if (!FormData) {
	FormData	= require('form-data');
}


/*** BitcoinJS ***/

var Bitcoin	= typeof window != 'undefined' ? window.Bitcoin : null;
if (!Bitcoin) {
	Bitcoin	= require('bitcoinjs-lib');
}


/*** Bitcore ***/

var bitcore	= require('bitcore');


/*** Local storage ***/

var storage;

try {
	storage	= require('node-persist');
}
catch (e) {}

if (storage) {
	storage.initSync();
}
else {
	var old$	= {$: null, jQuery: null};

	for (var k in old$) {
		old$[k]	= window[k];
		delete window[k];
	}

	window.$		= {};

	/*** jStorage ***/

	var jStorage	= window.$.jStorage;

	for (var k in old$) {
		window[k]	= old$[k];
	}

	storage			= {};

	var mappings	= {
		setItem: 'set',
		getItem: 'get',
		removeItem: 'deleteKey'
	};

	for (var k in mappings) {
		(function () {
			var f		= jStorage[mappings[k]];
			storage[k]	= function () { return f.apply(jStorage, arguments) };
		}());
	}
}


/*** Exchange rates ***/

var exchangeRates;

function setExchangeRates (request) {
	try {
		exchangeRates	= JSON.parse(request.responseText.replace(/\s/g, '').replace(/,\}$/, '}'));

		for (var k in exchangeRates) {
			exchangeRates[k]	= exchangeRates[k].last;
		}

		exchangeRates.BTC	= 1;
	}
	catch (e) {}
}

function getGetExchangeRates (isAsync) {
	var sendRequest;

	if (isAsync) {
		sendRequest	= function (request) {
			request.onreadystatechange	= function () {
				if (request.readyState == 4 && request.status == 200) {
					setExchangeRates(request);
				}
			};

			request.send();
		};
	}
	else {
		sendRequest	= function (request) {
			request.send();
			setExchangeRates(request);
		};
	}

	return function () {
		var request	= new XMLHttpRequest();
		request.open('GET', 'https://blockchain.info/ticker?cors=true', isAsync);
		sendRequest(request);
	};
}

getGetExchangeRates(false)();
setInterval(getGetExchangeRates(true), 3600000);


/*** Wallet ***/

Wallet	= function (options) {
	options	= options || {};

	if (typeof options == 'Wallet') {
		for (var k in {localCurrency: null, key: null, isReadOnly: null, address: null}) {
			this[k]	= options[k];
		}
	}
	else {
		this.localCurrency	= options.localCurrency || 'BTC';

		if (options.wif) {
			this.key		= options.wif;
		}
		else if (!options.address) {
			this.key		= Bitcoin.ECKey.makeRandom().toWIF();
		}

		this.isReadOnly		= !this.key;
		this.address		= this.isReadOnly ? options.address : Bitcoin.ECKey.fromWIF(this.key).pub.getAddress().toString();
	}
};

Wallet.prototype.getBalance	= function (callback) {
	if (!callback) {
		return;
	}

	var self	= this;

	var request	= new XMLHttpRequest();

	request.onreadystatechange	= function () {
		if (request.readyState == 4 && request.status == 200) {
			var balance	= parseInt(request.responseText || '0', 10) / 100000000;

			callback({btc: balance, local: parseFloat((balance * exchangeRates[self.localCurrency]).toFixed(2))});
		}
	};

	request.open('GET', 'https://blockchain.info/q/addressbalance/' + self.address + '?cors=true', true);
	request.send();
};

Wallet.prototype.getTransactionHistory	= function (callback) {
	if (!callback) {
		return;
	}

	var self	= this;

	var request	= new XMLHttpRequest();

	request.onreadystatechange	= function () {
		if (request.readyState == 4 && request.status == 200) {
			var exchangeRate	= exchangeRates[self.localCurrency];
			
			var transactions;
			try {
				transactions	= JSON.parse(request.responseText).txs || [];
			}
			catch (e) {
				transactions	= [];
			}

			for (var i = 0 ; i < transactions.length ; ++i) {
				var transaction	= transactions[i];

				var senderAddresses		= {};
				var recipientAddresses	= {};

				transaction.valueInLocal	= transaction.valueIn * exchangeRate;
				transaction.valueOutLocal	= transaction.valueOut * exchangeRate;
				transaction.amount			= transaction.valueOutLocal;

				for (var j = 0 ; j < transaction.vin.length ; ++j) {
					var vin	= transaction.vin[j];

					transaction.wasSentByMe	= transaction.wasSentByMe || vin.addr == self.address;
					vin.valueLocal			= vin.value * exchangeRate;

					senderAddresses[vin.addr]	= true;
				}

				for (var j = 0 ; j < transaction.vout.length ; ++j) {
					var vout	= transaction.vout[j];

					vout.valueLocal	= parseFloat(vout.value, 10) * exchangeRate;

					for (var k = 0 ; k < vout.scriptPubKey.addresses.length ; ++k) {
						var recipientAddress	= vout.scriptPubKey.addresses[k];

						if (senderAddresses[recipientAddress]) {
							transaction.amount	-= vout.valueLocal;
						}
						else {
							recipientAddresses[recipientAddress]	= true;
						}
					}
				}

				/* Friendly properties */
				transaction.amount		= parseFloat(transaction.amount.toFixed(2));
				transaction.isConfirmed	= (transaction.confirmations || 0) >= 6;
				transaction.senders		= Object.keys(senderAddresses);
				transaction.recipients	= Object.keys(recipientAddresses);
				transaction.time		= transaction.time ? new Date(transaction.time * 1000) : new Date();
				// transaction.txid
				transaction.wasSentByMe	= false;
			}

			callback(transactions);
		}
	};

	request.open('GET', 'http://insight.bitpay.com/api/txs/?address=' + self.address, true);
	request.send();
};

Wallet.prototype.onReceive	= function (callback, shouldIncludeUnconfirmed) {
	if (!callback) {
		return;
	}

	var self	= this;

	var previousTransactionsKey	= 'simplebtcPreviousTransactions' + self.address;
	var previousTransactions	= storage.getItem(previousTransactionsKey) || {};

	function persistPreviousTransactions () {
		storage.setItem(previousTransactionsKey, previousTransactions);
	}

	var processReceiptLock	= false;

	function processReceipt () {
		if (processReceiptLock) {
			return;
		}

		processReceiptLock	= true;

		self.getTransactionHistory(function (transactions) {
			try {
				for (var i = 0 ; i < transactions.length ; ++i) {
					var transaction	= transactions[i];

					if (transaction.isConfirmed || shouldIncludeUnconfirmed) {
						var txid		= transaction.txid;

						if (!previousTransactions[txid]) {
							if (!transaction.wasSentByMe) {
								callback(transaction);
							}

							previousTransactions[txid]	= true;
						}
					}
				}
			}
			finally {
				processReceiptLock	= false;
				persistPreviousTransactions();
			}
		});
	}

	function setProcessReceiptInterval () {
		setInterval(processReceipt, 300000);
	}

	if (Object.keys(previousTransactions).length > 0) {
		processReceipt();
		setProcessReceiptInterval();
	}
	else {
		self.getTransactionHistory(function (initialTransactionHistory) {
			for (var i = 0 ; i < initialTransactionHistory.length ; ++i) {
				var transaction	= initialTransactionHistory[i];

				if (transaction.isConfirmed) {
					previousTransactions[transaction.txid]	= true;
				}
			}

			persistPreviousTransactions();

			setProcessReceiptInterval();
		});
	}
};

var PUSHTX_URL	= 'https://blockchain.info/pushtx?cors=true';

Wallet.prototype.send	= function (recipientAddress, amount, callback) {
	var self	= this;

	if (self.isReadOnly) {
		callback && callback(false, 'Read-only wallet');
		return;
	}

	self.getBalance(function (balance) {
		amount	= amount / exchangeRates[self.localCurrency];

		if (amount > balance.btc) {
			callback && callback(false, 'Insufficient funds');
			return;
		}
		else if (balance.btc - amount < 0.0002) {
			amount	= balance.btc;
		}

		var unspentRequest	= new XMLHttpRequest();

		unspentRequest.onreadystatechange	= function () {
			if (unspentRequest.readyState == 4 && unspentRequest.status == 200) {
				var _Bitcoin	= Bitcoin;
				var transaction;

				var originatingTransactionsKey	= 'simplebtcOriginatingTransactions' + self.address;
				var originatingTransactions		= storage.getItem(originatingTransactionsKey) || {};

				function persistOriginatingTransactions () {
					storage.setItem(originatingTransactionsKey, originatingTransactions);
				}

				var utxo	= JSON.parse(unspentRequest.responseText) || [];

				for (var i = 0 ; i < utxo.length ; ++i) {
					var txout	= utxo[i];

					if (originatingTransactions[txout.txid]) {
						if (!txout.confirmations) {
							txout.confirmations	= 1;
						}
						else {
							delete originatingTransactions[txout.txid];
						}
					}
				}

				persistOriginatingTransactions();

				function createBitcoreTransaction () {
					transaction	= new bitcore.TransactionBuilder()
						.setUnspent(utxo)
						.setOutputs([{
							address:
								recipientAddress.address ?
									recipientAddress.address :
									recipientAddress.pub ?
										recipientAddress.pub.getAddress().toString() :
										recipientAddress
							,
							amount: amount
						}])
						.sign([self.key])
						.build()
					;
				}

				try {
					var count	= 0;

					while (true) {
						try {
							createBitcoreTransaction();
							break;
						}
						catch (e) {
							if (e.message.indexOf('totalNeededAmount') > -1) {
								amount	-= 0.00005;

								if (++count > 100) {
									callback && callback(false, e.message);
									return;
								}
							}
							else {
								throw e;
							}
						}
					}
				}
				finally {
					Bitcoin	= _Bitcoin;
				}

				var txid	= transaction.getHash().toString('hex');
				originatingTransactions[txid]	= true;
				persistOriginatingTransactions();

				
				var formData	= new FormData();
				formData.append('tx', transaction.serialize().toString('hex'));

				if (formData.submit) {
					formData.submit(PUSHTX_URL, callback && function (err, res) {
						var body	= '';

						res.on('data', function (datum) {
							body	+= datum;
						});

						res.on('end', function () {
							callback(res.statusCode == 200, body);
						});
					});
				}
				else {
					var pushtxRequest	= new XMLHttpRequest();

					if (callback) {
						pushtxRequest.onreadystatechange	= function () {
							if (pushtxRequest.readyState == 4) {
								callback(pushtxRequest.status == 200, pushtxRequest.responseText);
							}
						};
					}

					pushtxRequest.open('POST', PUSHTX_URL, true);
					pushtxRequest.send(formData);
				}
			}
		};

		unspentRequest.open('GET', 'http://insight.bitpay.com/api/addr/' + self.address + '/utxo?noCache=1', true);
		unspentRequest.send();
	});
};


if (typeof module != 'undefined' && module.exports) {
	module.exports.Wallet	= Wallet;
}


}());
