import {PrivateKey} from 'bitcore-lib';
import {Observable} from 'rxjs';


declare module 'simplebtc' {
	/** A Bitcoin transaction record. */
	interface Transaction {
		/** Transaction amount (in local currency). */
		amount: number;

		/** BitPay Insight transaction object. */
		baseTransaction: any;

		/** Transaction ID. */
		id: string;

		/** Indicates whether transaction is confirmed. */
		isConfirmed: boolean;

		/** Recipient addresses. */
		recipients: string[];

		/** Sender addresses. */
		senders: string[];

		/** Timestamp. */
		timestamp: number;

		/** Indicates whether the current wallet was the sender. */
		wasSentByMe: boolean;
	}

	/** A Bitcoin wallet. */
	class Wallet {
		/** Wallet address. */
		readonly address: string;

		/**
		 * Base URL of Insight blockchain explorer API.
		 * Defaults to "https://insight.bitpay.com/api".
		 */
		readonly insightBaseURL: string;

		/** Indicates whether wallet is read-only (i.e. private key is unknown). */
		readonly isReadOnly: boolean;

		/** Local currency code (BTC by default). */
		readonly localCurrency: string;

		/** Wallet private key. */
		readonly key: PrivateKey&{
			toBuffer: () => Uint8Array;
			toWIF: () => string;
		};

		/** Gets balance (in BTC and local currency). */
		getBalance () : Promise<{btc: number; local: number}>;

		/** Gets transaction history, sorted by timestamp in descending order. */
		getTransactionHistory () : Promise<Transaction[]>;

		/**
		 * Sends money.
		 * @param amount Amount in local currency.
		 * @returns Server broadcast method response message.
		 */
		send (
			recipientAddress: string|Wallet|{getAddress: () => {toString: () => string}},
			amount: number
		) : Promise<string>;

		/** Watches for new transactions as they occur. */
		watchNewTransactions () : Observable<Transaction>;

		/** Watches transaction history. */
		watchTransactionHistory () : Observable<Transaction[]>;

		constructor (options?: Wallet|{
			address?: string;
			insightBaseURL?: string;
			key?: Uint8Array|string;
			localCurrency?: string;
		});
	}

	/** Minimum ("dust") transaction amount. */
	const minimumTransactionAmount: number;

	/** Static fee for all transactions. */
	const transactionFee: number;

	/** Returns exchange rates between various currencies and Bitcoin. */
	const getExchangeRates: () => Promise<{[currencyCode: string]: number}>;
}
