simplebtc
==============

Simple JavaScript Bitcoin helper library (built on [BitcoinJS](http://bitcoinjs.org/), [Bitcore](http://bitcore.io/), [Blockchain.info](http://blockchain.info/), and [Insight](http://insight.bitpay.com/))


### Require (Node.js)

```
	var Wallet = require('simplebtc').Wallet;
```

### Constructor

```
	var wallet = new Wallet(/* [WIF string], [local currency code] */);
```

### Balance

```
	wallet.getBalance(function (balance) {
		// balance.btc == 0.0482
		// balance.local == 30
	});
```

### Transactions

```
	wallet.getTransactionHistory(function (transactions) {

	});
```

### Handle Receiving Money

```
	wallet.onReceive(function (transaction) {

	});
```

Note: This will try to use browser local storage or [node-persist](https://github.com/simonlast/node-persist) to log previous transactions. If unavailable, the event will only be triggered by transactions which occur after this method was called.

### Send Money

```
	wallet.send('1BTCorgHwCg6u2YSAWKgS17qUad6kHmtQW', 30, function () {
		// $30 sent to recipient
	});
```

### Export Wallet (to [WIF](https://en.bitcoin.it/wiki/Wallet_import_format))

```
	wallet.key.toWIF()
	// KxMhr6RcBk9N2D8sZTsbjjfpbPonm4BnpTLZn8G4fdEUdoVvdkNC
```
