import Bundlr from '@bundlr-network/client';
import BigNumber from 'bignumber.js';

type BundlrClient = InstanceType<typeof Bundlr>;

export interface ArweavePublisherOptions {
  url: string;
  currency: string;
  walletKey: string;
  contentGateway?: string;
}

export class ArweavePublisher {
  private bundlr: BundlrClient;
  private gateway: string;

  constructor(options: ArweavePublisherOptions) {
    const key = JSON.parse(options.walletKey);
    this.bundlr = new Bundlr(options.url, options.currency, key);
    this.gateway = options.contentGateway || 'https://arweave.net';
  }

  private async ensureBalance(required: BigNumber): Promise<void> {
    const balance = await this.bundlr.getLoadedBalance();
    if (balance.isGreaterThanOrEqualTo(required)) {
      return;
    }
    // Add a 10% buffer to avoid underfunding due to rounding.
    const funding = required.minus(balance).multipliedBy(1.1);
    await this.bundlr.fund(funding.integerValue(BigNumber.ROUND_CEIL));
  }

  async uploadJson(data: Record<string, any>): Promise<string> {
    const payload = Buffer.from(JSON.stringify(data));
    const price = await this.bundlr.getPrice(payload.length);
    await this.ensureBalance(price);

    const result = await this.bundlr.upload(payload, {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    });

    return `${this.gateway}/${result.id}`;
  }
}

export function createArweavePublisherFromEnv(): ArweavePublisher | null {
  const url = process.env.ARWEAVE_BUNDLR_URL;
  const walletKey = process.env.ARWEAVE_WALLET_KEY;
  const currency = process.env.ARWEAVE_CURRENCY || 'arweave';
  const gateway = process.env.ARWEAVE_GATEWAY_URL || 'https://arweave.net';

  if (!url || !walletKey) {
    return null;
  }

  return new ArweavePublisher({
    url,
    currency,
    walletKey,
    contentGateway: gateway,
  });
}
