/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import type { SoraStatus } from './soraUtils';

const imageData: {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  videos: Record<string, { url: string; thumbnail?: string } | undefined>;
  tasks: Record<string, { status: SoraStatus; error?: string } | undefined>;
} = {
  inputs: {},
  outputs: {},
  videos: {},
  tasks: {},
}

export default imageData;
