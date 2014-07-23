simplebtc
==============

Simple JavaScript Bitcoin helper library (built on [BitcoinJS](http://bitcoinjs.org/), [Bitcore](http://bitcore.io/), [Blockchain.info](http://blockchain.info/), and [Insight](http://insight.bitpay.com/))


### Constructor

```
	var wallet = new Wallet(/* [WIF key], [local currency code] */);
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

### Send Money

```
	wallet.send('1BTCorgHwCg6u2YSAWKgS17qUad6kHmtQW', 30, function () {
		// $30 sent to recipient
	});
```
