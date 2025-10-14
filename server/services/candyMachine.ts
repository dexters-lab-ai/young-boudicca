import { Connection, Keypair, PublicKey, Commitment, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, sol, toBigNumber, candyMachineModule, CandyMachine, SolAmount, toDateTime, DefaultCandyGuardSettings } from '@metaplex-foundation/js';

export interface CandyMachineConfig {
  rpcUrl: string;
  commitment: Commitment;
  authoritySecretKey: string;
  treasuryWallet: string;
  collectionMint: string;
  priceSol: number;
  sellerFeeBasisPoints: number;
}

export function createCandyMachineConfigFromEnv(): CandyMachineConfig | null {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  const commitment = (process.env.SOLANA_RPC_COMMITMENT as Commitment) || 'confirmed';
  const authoritySecret = process.env.CANDY_MACHINE_AUTHORITY_SECRET;
  const treasuryWallet = process.env.CANDY_MACHINE_TREASURY_WALLET;
  const collectionMint = process.env.CANDY_MACHINE_COLLECTION_MINT;
  const priceSol = Number(process.env.CANDY_MACHINE_PRICE_SOL || '0.1');
  const sellerFeeBasisPoints = Number(process.env.CANDY_MACHINE_SELLER_FEE_BPS || '500');

  if (!authoritySecret || !treasuryWallet || !collectionMint) {
    return null;
  }

  return {
    rpcUrl,
    commitment,
    authoritySecretKey: authoritySecret,
    treasuryWallet,
    collectionMint,
    priceSol,
    sellerFeeBasisPoints,
  };
}

export interface CandyMachineServiceOptions {
  connection: Connection;
  metaplex: Metaplex;
  authority: Keypair;
  treasury: PublicKey;
  collectionMint: PublicKey;
  price: SolAmount;
  sellerFeeBasisPoints: number;
}

export class CandyMachineService {
  private connection: Connection;
  private metaplex: Metaplex;
  private authority: Keypair;
  private treasury: PublicKey;
  private collectionMint: PublicKey;
  private price: SolAmount;
  private sellerFeeBasisPoints: number;

  constructor(options: CandyMachineServiceOptions) {
    this.connection = options.connection;
    this.metaplex = options.metaplex;
    this.authority = options.authority;
    this.treasury = options.treasury;
    this.collectionMint = options.collectionMint;
    this.price = options.price;
    this.sellerFeeBasisPoints = options.sellerFeeBasisPoints;
  }

  static async fromEnv(config: CandyMachineConfig): Promise<CandyMachineService> {
    const connection = new Connection(config.rpcUrl, config.commitment);

    const authoritySecret = Uint8Array.from(JSON.parse(config.authoritySecretKey));
    const authorityKeypair = Keypair.fromSecretKey(authoritySecret);

    const metaplex = Metaplex.make(connection).use(keypairIdentity(authorityKeypair)).use(candyMachineModule());

    const treasury = new PublicKey(config.treasuryWallet);
    const collectionMint = new PublicKey(config.collectionMint);

    return new CandyMachineService({
      connection,
      metaplex,
      authority: authorityKeypair,
      treasury,
      collectionMint,
      price: sol(config.priceSol),
      sellerFeeBasisPoints: config.sellerFeeBasisPoints,
    });
  }

  async ensureCollection(): Promise<void> {
    const nft = await this.metaplex.nfts().findByMint({ mintAddress: this.collectionMint });
    if (!nft) {
      throw new Error('Collection NFT not found. Mint collection first.');
    }
  }

  async loadCandyMachine(address: PublicKey): Promise<CandyMachine | null> {
    try {
      const candyMachine = await this.metaplex.candyMachines().findByAddress({ address });
      return candyMachine;
    } catch (error) {
      console.warn('Candy machine lookup failed:', error);
      return null;
    }
  }

  async createCandyMachine(params: {
    itemsAvailable: number;
    startDate?: Date;
  }): Promise<CandyMachine> {
    await this.ensureCollection();

    const goLiveDate = params.startDate ?? new Date();

    const defaultGuards = {
      solPayment: {
        amount: this.price,
        destination: this.treasury,
      },
      startDate: {
        date: toDateTime(goLiveDate),
      },
    } as unknown as DefaultCandyGuardSettings;

    const { candyMachine } = await this.metaplex.candyMachines().create({
      collection: {
        address: this.collectionMint,
        updateAuthority: this.authority,
      },
      sellerFeeBasisPoints: this.sellerFeeBasisPoints,
      itemsAvailable: toBigNumber(params.itemsAvailable),
      creators: [
        {
          address: this.authority.publicKey,
          share: 100,
        },
      ],
      guards: {
        default: defaultGuards,
      },
    });

    return candyMachine;
  }

  async addItems(candyMachineOrAddress: CandyMachine | PublicKey, items: { name: string; uri: string }[]): Promise<void> {
    if (!items.length) {
      return;
    }

    const candyMachine = candyMachineOrAddress instanceof PublicKey
      ? await this.metaplex.candyMachines().findByAddress({ address: candyMachineOrAddress })
      : candyMachineOrAddress;

    await this.metaplex.candyMachines().insertItems({
      candyMachine,
      authority: this.authority,
      items,
    });
  }

  async mint(candyMachine: CandyMachine, owner?: PublicKey): Promise<string> {
    const { nft } = await this.metaplex.candyMachines().mint({
      candyMachine,
      collectionUpdateAuthority: this.authority.publicKey,
      mintAuthority: this.authority,
      owner: owner ?? this.authority.publicKey,
    });
    return nft.address.toBase58();
  }
}
