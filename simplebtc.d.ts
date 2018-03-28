import {Observable} from 'rxjs/Observable';


declare module 'simplebtc' {
	/** A Bitcoin transaction record. */
	interface Transaction {
		/** Transaction amount (in local currency). */
		amount: number;

		/** BitPay Insight transaction object. */
		baseTransaction: any;

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

		/** Indicates whether wallet is read-only (i.e. private key is unknown). */
		readonly isReadOnly: boolean;

		/** Local currency code (BTC by default). */
		readonly localCurrency: string;

		/** Wallet private key in WIF format. */
		readonly key: string;

		/** Gets balance (in BTC and local currency). */
		getBalance () : Promise<{btc: number; local: number}>;

		/** Gets transaction history. */
		getTransactionHistory () : Promise<Transaction[]>;

		/**
		 * Sends money.
		 * @param amount Amount in local currency.
		 */
		send (
			recipientAddress: string|Wallet|{getAddress: () => {toString: () => string}},
			amount: number
		) : Promise<string>;

		/** Watches transaction history. */
		watchTransactionHistory () : Observable<Transaction[]>;

		constructor (options?: Wallet|{
			address?: string;
			localCurrency?: string;
			wif?: string;
		});
	}

	/** Returns exchange rates between various currencies and Bitcoin. */
	const getExchangeRates: () => Promise<{[currencyCode: string]: number}>;
}
