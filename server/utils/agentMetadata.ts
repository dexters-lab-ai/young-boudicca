import type { IAsset } from '../models/Asset';

export interface AgentMetadataInput {
  name: string;
  description: string;
  systemInstruction: string;
  creatorWalletAddress: string;
  vrmSource: {
    url: string;
    contentType: string;
    asset?: IAsset;
  };
  animations: Record<string, string>;
  environmentUrl?: string;
}

export function buildAgentMetadata(input: AgentMetadataInput): Record<string, any> {
  const attributes = [
    { trait_type: 'Creator Wallet', value: input.creatorWalletAddress },
    { trait_type: 'Has VRM Asset', value: input.vrmSource.asset ? 'yes' : 'external' },
  ];

  const animationEntries = Object.entries(input.animations).filter(([, url]) => Boolean(url));
  for (const [key, url] of animationEntries) {
    attributes.push({ trait_type: `Animation:${key}`, value: url });
  }

  const files = [
    {
      uri: input.vrmSource.url,
      type: input.vrmSource.contentType || 'application/octet-stream',
      role: 'primary_model',
    },
  ];

  const properties: Record<string, any> = {
    category: 'vrm-model',
    files,
  };

  const metadata: Record<string, any> = {
    name: input.name,
    description: input.description,
    attributes,
    properties,
    animation_url: input.vrmSource.url,
    system_instruction: input.systemInstruction,
  };

  if (input.environmentUrl) {
    metadata.image = input.environmentUrl;
  }

  if (animationEntries.length) {
    metadata.animations = animationEntries.map(([label, url]) => ({ label, url }));
  }

  return metadata;
}
