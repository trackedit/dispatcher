import { uuidv7 } from 'uuidv7'

/**
 * Generate a UUIDv7 (time-ordered UUID)
 * UUIDv7 includes a timestamp component, making it sortable by creation time
 */
export function generateCampaignId(): string {
  return uuidv7()
}

