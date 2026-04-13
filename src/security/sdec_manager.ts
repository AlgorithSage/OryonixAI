export class SDECManager {
  private static instance: SDECManager;
  private volatileBuffer: Uint8Array | null = null;
  private ttlTimeoutId: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): SDECManager {
    if (!SDECManager.instance) {
      SDECManager.instance = new SDECManager();
    }
    return SDECManager.instance;
  }

  /**
   * Generates a 256-bit AES-GCM Key.
   */
  public async generateKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Decrypts an encrypted payload and stores it in the volatile RAM buffer.
   * Schedules a 30-second TTL hard-wipe.
   */
  public async decryptToVolatileMemory(
    encryptedData: ArrayBuffer,
    iv: Uint8Array,
    key: CryptoKey
  ): Promise<void> {
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        encryptedData
      );
      
      this.volatileBuffer = new Uint8Array(decrypted);

      // SDEC Rule: 30-sec TTL Hard Wipe
      if (this.ttlTimeoutId) clearTimeout(this.ttlTimeoutId);
      this.ttlTimeoutId = setTimeout(() => {
        this.triggerWipe('TTL_EXPIRED');
      }, 30000);

    } catch (e) {
      console.error('SDEC Decryption Failed:', e);
      this.triggerWipe('DECRYPTION_ERROR');
    }
  }

  /**
   * Retrieves data strictly from volatile memory and decodes it stringentially.
   */
  public getVolatileData(): string | null {
    if (!this.volatileBuffer) return null;
    return new TextDecoder().decode(this.volatileBuffer);
  }

  /**
   * Wipes the volatile buffer with null bytes (0x00) immediately.
   */
  public triggerWipe(reason: string): void {
    if (this.volatileBuffer) {
      crypto.getRandomValues(this.volatileBuffer); // Scramble first
      this.volatileBuffer.fill(0x00); // Null byte overwrite
      this.volatileBuffer = null;
    }
    
    if (this.ttlTimeoutId) {
      clearTimeout(this.ttlTimeoutId);
      this.ttlTimeoutId = null;
    }
    
    console.debug(`[SDEC] Memory wiped. Reason: ${reason}`);
  }
}

export const sdec = SDECManager.getInstance();
