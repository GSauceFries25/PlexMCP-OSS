-- Add encryption version tracking for PIN-based API key encryption
-- Version 1 = SHA-256 (legacy, insecure for PINs), Version 2 = Argon2id (current)
-- SOC 2 CC6.1: Upgrade key derivation to prevent brute-force attacks on 4-digit PINs

ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS encryption_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN api_keys.encryption_version IS
  'Key derivation version: 1=SHA-256 (legacy), 2=Argon2id (secure)';

-- Index for finding keys that need migration (v1 keys with encryption)
CREATE INDEX IF NOT EXISTS idx_api_keys_encryption_version
ON api_keys(encryption_version) WHERE encrypted_key IS NOT NULL;
