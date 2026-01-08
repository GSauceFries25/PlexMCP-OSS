-- Auto-generated memorable subdomains for all organizations
-- Format: {adjective}-{noun}-{number} (e.g., swift-cloud-742)
-- Deterministic based on org_id for consistency

-- =============================================================================
-- Word Lists Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS subdomain_words (
    id SERIAL PRIMARY KEY,
    word_type VARCHAR(20) NOT NULL,  -- 'adjective' or 'noun'
    word VARCHAR(50) NOT NULL,
    UNIQUE(word_type, word)
);

-- =============================================================================
-- Insert Adjectives (100 words, sorted alphabetically)
-- =============================================================================

INSERT INTO subdomain_words (word_type, word) VALUES
('adjective', 'agile'), ('adjective', 'amber'), ('adjective', 'azure'),
('adjective', 'bold'), ('adjective', 'bright'),
('adjective', 'calm'), ('adjective', 'clear'), ('adjective', 'cool'),
('adjective', 'coral'), ('adjective', 'crisp'), ('adjective', 'cyan'),
('adjective', 'dark'), ('adjective', 'deep'),
('adjective', 'eager'), ('adjective', 'early'), ('adjective', 'easy'),
('adjective', 'elite'), ('adjective', 'epic'), ('adjective', 'even'),
('adjective', 'exact'), ('adjective', 'extra'),
('adjective', 'fair'), ('adjective', 'fancy'), ('adjective', 'fast'),
('adjective', 'fine'), ('adjective', 'firm'), ('adjective', 'first'),
('adjective', 'focal'), ('adjective', 'free'), ('adjective', 'fresh'),
('adjective', 'gold'), ('adjective', 'good'), ('adjective', 'grand'),
('adjective', 'great'), ('adjective', 'green'),
('adjective', 'happy'),
('adjective', 'ideal'), ('adjective', 'inner'),
('adjective', 'keen'), ('adjective', 'kind'),
('adjective', 'laser'), ('adjective', 'light'), ('adjective', 'live'),
('adjective', 'long'), ('adjective', 'loud'), ('adjective', 'lucky'),
('adjective', 'lunar'),
('adjective', 'major'), ('adjective', 'mega'),
('adjective', 'neat'), ('adjective', 'new'), ('adjective', 'noble'),
('adjective', 'odd'), ('adjective', 'open'),
('adjective', 'plain'), ('adjective', 'prime'), ('adjective', 'proud'),
('adjective', 'pure'),
('adjective', 'quick'), ('adjective', 'quiet'),
('adjective', 'rapid'), ('adjective', 'rare'), ('adjective', 'rich'),
('adjective', 'royal'),
('adjective', 'safe'), ('adjective', 'sharp'), ('adjective', 'shiny'),
('adjective', 'silent'), ('adjective', 'silver'), ('adjective', 'simple'),
('adjective', 'sleek'), ('adjective', 'slim'), ('adjective', 'smart'),
('adjective', 'smooth'), ('adjective', 'soft'), ('adjective', 'solid'),
('adjective', 'stable'), ('adjective', 'stark'), ('adjective', 'steady'),
('adjective', 'still'), ('adjective', 'strong'), ('adjective', 'sunny'),
('adjective', 'super'), ('adjective', 'sweet'), ('adjective', 'swift'),
('adjective', 'tall'), ('adjective', 'tidy'), ('adjective', 'tiny'),
('adjective', 'tough'), ('adjective', 'true'),
('adjective', 'vast'), ('adjective', 'vivid'),
('adjective', 'warm'), ('adjective', 'white'), ('adjective', 'wide'),
('adjective', 'wild'), ('adjective', 'wise'),
('adjective', 'young'),
('adjective', 'zesty')
ON CONFLICT (word_type, word) DO NOTHING;

-- =============================================================================
-- Insert Nouns (100 words, sorted alphabetically)
-- =============================================================================

INSERT INTO subdomain_words (word_type, word) VALUES
('noun', 'apex'), ('noun', 'arc'), ('noun', 'aspen'), ('noun', 'atlas'),
('noun', 'beam'), ('noun', 'bear'), ('noun', 'birch'), ('noun', 'bolt'),
('noun', 'bond'), ('noun', 'bridge'), ('noun', 'brook'),
('noun', 'canyon'), ('noun', 'cedar'), ('noun', 'cliff'), ('noun', 'cloud'),
('noun', 'comet'), ('noun', 'core'), ('noun', 'cosmos'), ('noun', 'cove'),
('noun', 'crane'), ('noun', 'crystal'),
('noun', 'dragon'),
('noun', 'eagle'),
('noun', 'falcon'), ('noun', 'field'), ('noun', 'flame'), ('noun', 'flow'),
('noun', 'forest'), ('noun', 'fox'), ('noun', 'frost'),
('noun', 'garden'), ('noun', 'gate'), ('noun', 'glass'), ('noun', 'glen'),
('noun', 'grove'),
('noun', 'harbor'), ('noun', 'haven'), ('noun', 'hawk'), ('noun', 'heron'),
('noun', 'hub'),
('noun', 'iris'), ('noun', 'iron'),
('noun', 'jade'),
('noun', 'lake'), ('noun', 'link'), ('noun', 'lion'), ('noun', 'lotus'),
('noun', 'maple'), ('noun', 'meadow'), ('noun', 'mesa'), ('noun', 'mint'),
('noun', 'moon'),
('noun', 'nebula'), ('noun', 'nexus'), ('noun', 'node'), ('noun', 'nova'),
('noun', 'oak'), ('noun', 'onyx'), ('noun', 'opal'), ('noun', 'orbit'),
('noun', 'owl'),
('noun', 'path'), ('noun', 'peak'), ('noun', 'phoenix'), ('noun', 'pine'),
('noun', 'port'), ('noun', 'prism'), ('noun', 'pulse'),
('noun', 'quasar'),
('noun', 'rain'), ('noun', 'raven'), ('noun', 'reef'), ('noun', 'ridge'),
('noun', 'river'), ('noun', 'road'),
('noun', 'sage'), ('noun', 'snow'), ('noun', 'spark'), ('noun', 'sphinx'),
('noun', 'spire'), ('noun', 'spring'), ('noun', 'star'), ('noun', 'steel'),
('noun', 'stone'), ('noun', 'storm'), ('noun', 'stream'), ('noun', 'summit'),
('noun', 'sun'), ('noun', 'surge'),
('noun', 'tiger'), ('noun', 'titan'), ('noun', 'tower'), ('noun', 'trail'),
('noun', 'vale'),
('noun', 'wave'), ('noun', 'willow'), ('noun', 'wind'), ('noun', 'wolf')
ON CONFLICT (word_type, word) DO NOTHING;

-- =============================================================================
-- Generate Subdomain Function (deterministic based on org_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_subdomain(org_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    hash_bytes BYTEA;
    adj_idx INT;
    noun_idx INT;
    num INT;
    adj_word VARCHAR(50);
    noun_word VARCHAR(50);
    adj_count INT;
    noun_count INT;
BEGIN
    -- Get counts of words
    SELECT COUNT(*) INTO adj_count FROM subdomain_words WHERE word_type = 'adjective';
    SELECT COUNT(*) INTO noun_count FROM subdomain_words WHERE word_type = 'noun';

    -- Use MD5 hash of org_id for deterministic randomness
    hash_bytes := decode(md5(org_id::text), 'hex');

    -- Extract indices from hash bytes (use different byte pairs for each)
    adj_idx := (get_byte(hash_bytes, 0) * 256 + get_byte(hash_bytes, 1)) % adj_count;
    noun_idx := (get_byte(hash_bytes, 2) * 256 + get_byte(hash_bytes, 3)) % noun_count;
    num := (get_byte(hash_bytes, 4) * 256 + get_byte(hash_bytes, 5)) % 1000;

    -- Get words using OFFSET (words are sorted alphabetically)
    SELECT word INTO adj_word FROM subdomain_words
        WHERE word_type = 'adjective' ORDER BY word LIMIT 1 OFFSET adj_idx;
    SELECT word INTO noun_word FROM subdomain_words
        WHERE word_type = 'noun' ORDER BY word LIMIT 1 OFFSET noun_idx;

    -- Return format: adjective-noun-000 through adjective-noun-999
    RETURN adj_word || '-' || noun_word || '-' || LPAD(num::text, 3, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- Add auto_subdomain Column to Organizations
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'auto_subdomain'
  ) THEN
    ALTER TABLE organizations ADD COLUMN auto_subdomain VARCHAR(50);
  END IF;
END $$;

-- =============================================================================
-- Backfill Existing Organizations with Memorable Subdomains
-- =============================================================================

UPDATE organizations
SET auto_subdomain = generate_subdomain(id)
WHERE auto_subdomain IS NULL;

-- Make column NOT NULL after backfill
ALTER TABLE organizations ALTER COLUMN auto_subdomain SET NOT NULL;

-- =============================================================================
-- Indexes for Fast Routing Lookups
-- =============================================================================

-- Unique index on auto_subdomain for routing
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_auto_subdomain
  ON organizations(auto_subdomain);

-- Ensure custom_subdomain index exists (may already exist from previous migration)
CREATE INDEX IF NOT EXISTS idx_organizations_custom_subdomain_routing
  ON organizations(custom_subdomain) WHERE custom_subdomain IS NOT NULL;

-- =============================================================================
-- Trigger to Auto-Generate Subdomain on New Organizations
-- =============================================================================

CREATE OR REPLACE FUNCTION set_auto_subdomain()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.auto_subdomain IS NULL THEN
    NEW.auto_subdomain := generate_subdomain(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_auto_subdomain ON organizations;
CREATE TRIGGER organizations_auto_subdomain
  BEFORE INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_auto_subdomain();

-- =============================================================================
-- Comments for Documentation
-- =============================================================================

COMMENT ON TABLE subdomain_words IS 'Word lists for generating memorable auto-subdomains';
COMMENT ON COLUMN subdomain_words.word_type IS 'Type of word: adjective or noun';
COMMENT ON COLUMN subdomain_words.word IS 'The word itself (sorted alphabetically within type)';
COMMENT ON FUNCTION generate_subdomain(UUID) IS 'Generate deterministic subdomain from org_id using MD5 hash. Format: {adjective}-{noun}-{000-999}';
COMMENT ON COLUMN organizations.auto_subdomain IS 'Auto-generated memorable subdomain (e.g., swift-cloud-742). Never changes once set.';
