import sharp from "sharp";
import { storeAvatarImage } from "../storage";

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 85;

/**
 * Process an avatar image buffer and store it.
 * Resizes to a 256x256 square crop, converts to JPEG.
 */
export async function processAndStoreAvatar(
  buffer: Buffer,
  profileId: string,
): Promise<{ path: string | null }> {
  try {
    const processed = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: AVATAR_QUALITY, mozjpeg: true })
      .toBuffer();

    const path = storeAvatarImage(processed, profileId);
    return { path };
  } catch (error) {
    console.error("Error processing avatar:", error);
    return { path: null };
  }
}
