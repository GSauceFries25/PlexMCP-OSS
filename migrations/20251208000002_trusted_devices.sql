-- Trusted devices for "Remember this device" feature
-- Allows users to skip 2FA on recognized devices for 30 days

CREATE TABLE user_trusted_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_2fa(user_id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,       -- SHA256 hash of device token
    device_name TEXT,                -- User-friendly name like "Chrome on macOS"
    ip_address TEXT,                 -- IP address when device was trusted
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Each user can only have one entry per device token hash
    UNIQUE(user_id, device_hash)
);

-- Index for looking up devices by user
CREATE INDEX idx_trusted_devices_user ON user_trusted_devices(user_id);

-- Index for cleanup job to find expired devices
CREATE INDEX idx_trusted_devices_expires ON user_trusted_devices(expires_at);

COMMENT ON TABLE user_trusted_devices IS 'Stores trusted devices that can skip 2FA verification';
COMMENT ON COLUMN user_trusted_devices.device_hash IS 'SHA256 hash of the device token (token stored in client cookie)';
COMMENT ON COLUMN user_trusted_devices.device_name IS 'User-friendly device identifier from User-Agent parsing';
COMMENT ON COLUMN user_trusted_devices.expires_at IS 'Device trust expires after 30 days by default';
