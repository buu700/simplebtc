#!/usr/bin/nodejs


var Wallet			= require('simplebtc').Wallet;
var fs				= require('fs');

var readLine		= require('readline').createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

var args			= process.argv.slice(2);

var simplebtcrcPath	= require('path').join(
	process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'],
	'.simplebtcrc'
);

var options	= {};


function formatTransaction (tx) {
	return {
		amount: tx.amount,
		isConfirmed: tx.isConfirmed,
		senders: tx.senders,
		recipients: tx.recipients,
		time: tx.time,
		wasSentByMe: tx.wasSentByMe
	};
}

function dothemove () {
	var wallet	= new Wallet(options);

	if (!(options.wif || options.address)) {
		console.log('\nNew wallet created with address ' + wallet.address + '\n');

		if (wallet.key) {
			options.wif	= wallet.key.toWIF();
		}
		else {
			options.address	= wallet.address;
		}

		fs.writeFileSync(simplebtcrcPath, JSON.stringify(options));
	}

	fs.chmodSync(simplebtcrcPath, 700);

	switch (args[0]) {
		case 'address':
			console.log(wallet.address);
			process.exit();

			return;

		case 'balance':
			wallet.getBalance(function (balance) {
				console.log(balance);
				process.exit();
			});

			return;

		case 'history':
			wallet.getTransactionHistory(function (transactions) {
				console.log(transactions.map(formatTransaction));
				process.exit();
			});

			return;

		case 'stream':
			wallet.onReceive(function (transaction) {
				console.log(formatTransaction(transaction));
			});

			return;

		case 'send':
			var recipient	= args[1];
			var amount		= args[2];

			if (recipient && amount) {
				wallet.send(recipient, amount, function (wasSuccessful, responseMessage) {
					console.log({
						wasSuccessful: wasSuccessful,
						responseMessage: responseMessage
					});

					process.exit();
				});

				return;
			}
			else {
				break;
			}
	}

	console.log(
		'Available commands:' +
			'\n\t* simplebtc address' +
			'\n\t* simplebtc balance' +
			'\n\t* simplebtc history' +
			'\n\t* simplebtc stream\t# continual stream of new transactions' +
			'\n\t* simplebtc send [recipient address] [amount in local currency]'
	);

	process.exit();
}


try {
	options	= JSON.parse(fs.readFileSync(simplebtcrcPath).toString().trim());
}
catch (e) {}

if (options.wif || options.address) {
	dothemove();
}
else {
	readLine.question('Local currency code (e.g. USD): ', function (localCurrency) {
		options.localCurrency	= localCurrency.trim();

		readLine.question('Bitcoin wallet WIF (optional): ', function (wif) {
			options.wif	= wif.trim();

			if (options.wif) {
				dothemove();
			}
			else {
				delete options.wif;

				readLine.question('Bitcoin wallet address (optional, read-only): ', function (address) {
					options.address	= address.trim();
					dothemove();
				});
			}
		});
	});
}
