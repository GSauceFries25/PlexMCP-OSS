//! In-memory domain cache with TTL
//!
//! Caches domain-to-org lookups to reduce database queries for routing.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Default cache TTL (5 minutes)
const DEFAULT_CACHE_TTL: Duration = Duration::from_secs(300);

/// Cache entry with expiration
#[derive(Clone)]
struct CacheEntry {
    org_id: Option<Uuid>,
    expires_at: Instant,
}

impl CacheEntry {
    fn new(org_id: Option<Uuid>, ttl: Duration) -> Self {
        Self {
            org_id,
            expires_at: Instant::now() + ttl,
        }
    }

    fn is_expired(&self) -> bool {
        Instant::now() > self.expires_at
    }
}

/// Thread-safe in-memory domain cache
pub struct DomainCache {
    /// Maps normalized host -> org_id (None means host doesn't resolve to any org)
    cache: RwLock<HashMap<String, CacheEntry>>,
    ttl: Duration,
}

impl Default for DomainCache {
    fn default() -> Self {
        Self::new()
    }
}

impl DomainCache {
    /// Create a new cache with default TTL
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            ttl: DEFAULT_CACHE_TTL,
        }
    }

    /// Create a new cache with custom TTL
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            ttl,
        }
    }

    /// Get cached org_id for a host
    /// Returns Some(Some(org_id)) if found and valid
    /// Returns Some(None) if host was cached as not resolving
    /// Returns None if not in cache or expired
    pub fn get(&self, host: &str) -> Option<Option<Uuid>> {
        let cache = self.cache.read().ok()?;
        let entry = cache.get(host)?;

        if entry.is_expired() {
            None
        } else {
            Some(entry.org_id)
        }
    }

    /// Cache a host -> org_id mapping
    pub fn set(&self, host: &str, org_id: Option<Uuid>) {
        if let Ok(mut cache) = self.cache.write() {
            cache.insert(host.to_string(), CacheEntry::new(org_id, self.ttl));
        }
    }

    /// Invalidate a specific host
    pub fn invalidate(&self, host: &str) {
        if let Ok(mut cache) = self.cache.write() {
            cache.remove(host);
        }
    }

    /// Invalidate all entries for an org (useful when org settings change)
    pub fn invalidate_org(&self, org_id: Uuid) {
        if let Ok(mut cache) = self.cache.write() {
            cache.retain(|_, entry| entry.org_id != Some(org_id));
        }
    }

    /// Clear expired entries (call periodically for memory management)
    pub fn cleanup(&self) {
        if let Ok(mut cache) = self.cache.write() {
            cache.retain(|_, entry| !entry.is_expired());
        }
    }

    /// Get cache statistics
    pub fn stats(&self) -> CacheStats {
        if let Ok(cache) = self.cache.read() {
            let total = cache.len();
            let expired = cache.values().filter(|e| e.is_expired()).count();
            CacheStats {
                total_entries: total,
                expired_entries: expired,
                active_entries: total - expired,
            }
        } else {
            CacheStats::default()
        }
    }
}

/// Cache statistics
#[derive(Default, Debug)]
pub struct CacheStats {
    pub total_entries: usize,
    pub expired_entries: usize,
    pub active_entries: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn test_cache_get_set() {
        let cache = DomainCache::new();
        let org_id = Uuid::new_v4();

        // Initially empty
        assert!(cache.get("test.plexmcp.com").is_none());

        // Set and get
        cache.set("test.plexmcp.com", Some(org_id));
        assert_eq!(cache.get("test.plexmcp.com"), Some(Some(org_id)));
    }

    #[test]
    fn test_cache_negative() {
        let cache = DomainCache::new();

        // Cache a negative result (host doesn't resolve)
        cache.set("unknown.example.com", None);
        assert_eq!(cache.get("unknown.example.com"), Some(None));
    }

    #[test]
    fn test_cache_expiration() {
        let cache = DomainCache::with_ttl(Duration::from_millis(50));
        let org_id = Uuid::new_v4();

        cache.set("test.plexmcp.com", Some(org_id));
        assert_eq!(cache.get("test.plexmcp.com"), Some(Some(org_id)));

        // Wait for expiration
        sleep(Duration::from_millis(60));
        assert!(cache.get("test.plexmcp.com").is_none());
    }

    #[test]
    fn test_cache_invalidate() {
        let cache = DomainCache::new();
        let org_id = Uuid::new_v4();

        cache.set("test.plexmcp.com", Some(org_id));
        cache.invalidate("test.plexmcp.com");
        assert!(cache.get("test.plexmcp.com").is_none());
    }

    #[test]
    fn test_cache_invalidate_org() {
        let cache = DomainCache::new();
        let org_id = Uuid::new_v4();
        let other_org = Uuid::new_v4();

        cache.set("a.plexmcp.com", Some(org_id));
        cache.set("b.plexmcp.com", Some(org_id));
        cache.set("c.plexmcp.com", Some(other_org));

        cache.invalidate_org(org_id);

        assert!(cache.get("a.plexmcp.com").is_none());
        assert!(cache.get("b.plexmcp.com").is_none());
        assert_eq!(cache.get("c.plexmcp.com"), Some(Some(other_org)));
    }
}
