simplebtc
==============

High-level Bitcoin library and command line tool; originally created for [Token](http://ychacks.challengepost.com/submissions/25791-token), currently used by [Cyph](https://www.cyph.com).

For complete API documentation, read the type declaration file.

### Import

```
	import {Wallet} from 'simplebtc';
```

### Constructor

```
	const wallet = new Wallet(/* {
		address: '1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz',
		key: 'L4udA8nLC1r2xCVuzretgKuAZkvQq2aCZWKgiGXrxWEcH956xeE2',
		localCurrency: 'USD'
	} */);
```

If a [WIF](https://en.bitcoin.it/wiki/Wallet_import_format) key is specified, it will be used to derive the private key and address, and money may be sent from the wallet.

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
	const balance = await wallet.getBalance();

	// balance == {btc: 0.0482, local: 30}
```

Command line:

```
	$ simplebtc balance
```

### Transactions

```
	const transactions = await wallet.getTransactionHistory();

	/* transactions == [{
		amount: 76.92,
		id: 'cf046a7e3303a7b44f86e4bb92367b4ae223e2c76dd0b45346de879acd482905',
		isConfirmed: true,
		recipients: ['1L8wTTMxSUw2vYmQb4xr9r4M1g8n2YFcgX'],
		senders: ['1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz'],
		timestamp: 1407970572000,
		wasSentByMe: true
	}, ...] */
```

Command line:

```
	$ simplebtc history
```

### Handle Receiving Money

```
	wallet.watchNewTransactions().subscribe(transaction => {
		console.log(transaction);
	});

	/* transaction == {
		amount: 76.92,
		id: 'cf046a7e3303a7b44f86e4bb92367b4ae223e2c76dd0b45346de879acd482905',
		isConfirmed: true,
		recipients: ['1L8wTTMxSUw2vYmQb4xr9r4M1g8n2YFcgX'],
		senders: ['1E4G7mwKozrTSUijjB2eFqgbU9zxToZbkz'],
		timestamp: 1407970572000,
		wasSentByMe: true
	} */
```

Command line:

```
	$ simplebtc stream
```

### Send Money

```
	await wallet.send('1BTCorgHwCg6u2YSAWKgS17qUad6kHmtQW', 30);

	// $30 sent to Bitcoin Foundation
```

Command line:

```
	$ simplebtc send [recipient address] [amount in local currency]
```

If available, this method will deduct the transaction fee in addition to the specified amount; otherwise, the fee will be subtracted from the amount being sent.

Similar to Bitcoin Core, unspent transaction outputs which originated locally will be treated as confirmed.

### Export Wallet to WIF

```
	wallet.key	// KxMhr6RcBk9N2D8sZTsbjjfpbPonm4BnpTLZn8G4fdEUdoVvdkNC
```

### Install

```
	$ npm install simplebtc
```
