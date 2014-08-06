simplebtc
==============

High-level Bitcoin library and command line tool, used by [Token](http://token.cx)

Simplebtc was built using [BitcoinJS](http://bitcoinjs.org/), [Bitcore](http://bitcore.io/), [Blockchain.info](http://blockchain.info/), and [Insight](http://insight.bitpay.com/).


### Require (Node.js)

```
	var Wallet = require('simplebtc').Wallet;
```

### Constructor

```
	var wallet = new Wallet(/* {
		localCurrency: 'USD',
		wif: 'Kzv6tgLee7NbNhv1Ch4kLqH8BpLHtHVEGnevKpCQ3wMq7drMjg14',
		address: '1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz'
	} */);
```

If a [WIF](https://en.bitcoin.it/wiki/Wallet_import_format) is specified, it will be used to derive the private key and address, and money may be sent from the wallet.

Otherwise, an address may be specified, in which case no private key will be generated and the wallet will be read-only.

If neither a WIF nor an address is specified, a new wallet with a new private key and address will be generated. This will not be read-only, but it will start off with a balance of 0 BTC.

### Address

```
	wallet.address	// 1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz
```

Command line:

```
	$ simplebtc address
```

### Balance

```
	wallet.getBalance(function (balance) {
		// balance == {btc: 0.0482, local: 30}
	});
```

Command line:

```
	$ simplebtc balance
```

### Transactions

```
	wallet.getTransactionHistory(function (transactions) {
		/* transactions == [{
			amount: 8.0606848794,
			isConfirmed: true,
			senders: ['13vexxX79cPv9UheXKHtPU3aefBX1zCv6R'],
			recipients: ['1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz'],
			time: Fri Jul 25 2014 21:16:09 GMT-0400 (EDT),
			wasSentByMe: false
		}, ...] */
	});
```

Command line:

```
	$ simplebtc history
```

### Handle Receiving Money

```
	wallet.onReceive(function (transaction) {

	}, /* shouldIncludeUnconfirmed */);
```

Command line:

```
	$ simplebtc stream
```

Note: This will try to use browser local storage or [node-persist](https://github.com/simonlast/node-persist) to log previous transactions. If unavailable, the event will only be triggered by transactions which occur after this method was called.

### Send Money

```
	wallet.send('1BTCorgHwCg6u2YSAWKgS17qUad6kHmtQW', 30, function (wasSuccessful, responseMessage) {
		/*
			wasSuccessful == true
			responseMessage == 'Transaction Submitted'

			$30 sent to Bitcoin Foundation
		*/
	});
```

Command line:

```
	$ simplebtc send [recipient address] [amount in local currency]
```

If available, this method will deduct the transaction fee in addition to the specified amount; otherwise, the fee will be subtracted from the amount being sent.

Similar to Bitcoin-Qt, unspent transaction outputs which originated locally will be treated as confirmed.

### Export Wallet to WIF

```
	wallet.key.toWIF()	// KxMhr6RcBk9N2D8sZTsbjjfpbPonm4BnpTLZn8G4fdEUdoVvdkNC
```

### Install (Node.js / command line)

```
	$ npm -g install simplebtc
```
