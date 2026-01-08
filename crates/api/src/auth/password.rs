//! Password hashing with Argon2

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash a password using Argon2id
pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| PasswordError::Hashing(e.to_string()))
}

/// Generate a cryptographically random "impossible" password hash
/// This is used for OAuth users who don't have a password
/// The hash is valid Argon2 format but the password is unknowable
/// SOC 2 CC6.1: Prevents password-based attacks on OAuth-only accounts
pub fn generate_impossible_hash() -> Result<String, PasswordError> {
    use argon2::password_hash::rand_core::RngCore;

    // Generate 64 bytes (512 bits) of random data
    let mut random_bytes = [0u8; 64];
    OsRng.fill_bytes(&mut random_bytes);

    // Convert to hex string (128 chars) for password
    let random_password = hex::encode(random_bytes);

    // Hash the random password
    hash_password(&random_password)
}

/// Verify a password against a hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool, PasswordError> {
    let parsed_hash =
        PasswordHash::new(hash).map_err(|e| PasswordError::InvalidHash(e.to_string()))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Validate password strength
pub fn validate_password_strength(password: &str) -> Result<(), PasswordValidationError> {
    // Length validation
    if password.len() < 12 {
        return Err(PasswordValidationError::TooShort);
    }

    if password.len() > 128 {
        return Err(PasswordValidationError::TooLong);
    }

    // Character type validation
    let has_lowercase = password.chars().any(|c| c.is_ascii_lowercase());
    let has_uppercase = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password
        .chars()
        .any(|c| "!@#$%^&*()_+-=[]{}|;:,.<>?/~`".contains(c));

    if !has_lowercase {
        return Err(PasswordValidationError::MissingLowercase);
    }

    if !has_uppercase {
        return Err(PasswordValidationError::MissingUppercase);
    }

    if !has_digit {
        return Err(PasswordValidationError::MissingDigit);
    }

    if !has_special {
        return Err(PasswordValidationError::MissingSpecialChar);
    }

    // Check against common passwords
    if is_common_password(password) {
        return Err(PasswordValidationError::TooCommon);
    }

    Ok(())
}

/// Check if password is in the common passwords list
fn is_common_password(password: &str) -> bool {
    // Lowercase comparison for case-insensitive matching
    let password_lower = password.to_lowercase();

    // Top 100 most common passwords (case-insensitive)
    const COMMON_PASSWORDS: &[&str] = &[
        "password",
        "password123",
        "password1",
        "password12",
        "123456",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty",
        "qwerty123",
        "abc123",
        "abcd1234",
        "letmein",
        "welcome",
        "welcome123",
        "admin",
        "admin123",
        "root",
        "root123",
        "toor",
        "pass",
        "pass123",
        "passw0rd",
        "p@ssw0rd",
        "p@ssword",
        "password!",
        "password1!",
        "password123!",
        "monkey",
        "dragon",
        "master",
        "sunshine",
        "princess",
        "football",
        "iloveyou",
        "shadow",
        "michael",
        "jennifer",
        "computer",
        "trustno1",
        "baseball",
        "superman",
        "batman",
        "starwars",
        "hello",
        "hello123",
        "freedom",
        "whatever",
        "qazwsx",
        "qweasd",
        "1q2w3e4r",
        "1qaz2wsx",
        "zaq12wsx",
        "abc12345",
        "mypassword",
        "changeme",
        "111111",
        "000000",
        "123123",
        "123321",
        "654321",
        "123qwe",
        "qwe123",
        "1234",
        "12345",
        "123456",
        "1234567",
        "12345678",
        "123456789",
        "test",
        "test123",
        "testtest",
        "guest",
        "guest123",
        "user",
        "user123",
        "default",
        "temptemp",
        "sample",
        "example",
        "demo",
        "demo123",
        "asdfgh",
        "zxcvbn",
        "qwertyuiop",
        "asdfghjkl",
        "zxcvbnm",
        "password1234",
        "password12345",
        "mypassword123",
        "welcome1",
        "welcome12",
        "welcome123",
        "master123",
        "admin1234",
        "administrator",
        "secret",
        "secret123",
        "letmein123",
        "password@123",
        "password#123",
        "qwerty12345",
    ];

    COMMON_PASSWORDS.contains(&password_lower.as_str())
}

/// Calculate password strength score (0-4)
/// 0 = Very Weak, 1 = Weak, 2 = Fair, 3 = Strong, 4 = Very Strong
pub fn calculate_password_strength(password: &str) -> PasswordStrength {
    let mut score: u8 = 0;
    let mut feedback = Vec::new();

    // Length scoring
    if password.len() >= 12 {
        score += 1;
    } else {
        feedback.push("Use at least 12 characters".to_string());
    }

    if password.len() >= 16 {
        score += 1;
    }

    // Character variety
    let has_lowercase = password.chars().any(|c| c.is_ascii_lowercase());
    let has_uppercase = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password
        .chars()
        .any(|c| "!@#$%^&*()_+-=[]{}|;:,.<>?/~`".contains(c));

    let char_types = [has_lowercase, has_uppercase, has_digit, has_special]
        .iter()
        .filter(|&&x| x)
        .count();

    match char_types {
        4 => score += 2,
        3 => score += 1,
        _ => {}
    }

    if !has_lowercase {
        feedback.push("Add lowercase letters".to_string());
    }
    if !has_uppercase {
        feedback.push("Add uppercase letters".to_string());
    }
    if !has_digit {
        feedback.push("Add numbers".to_string());
    }
    if !has_special {
        feedback.push("Add special characters (!@#$%^&*)".to_string());
    }

    // Common password penalty
    if is_common_password(password) {
        score = 0; // Common passwords are always very weak
        feedback.push("This is a commonly used password - choose something unique".to_string());
    }

    // Repeated characters penalty
    let has_repeated = password
        .chars()
        .collect::<Vec<_>>()
        .windows(3)
        .any(|w| w[0] == w[1] && w[1] == w[2]);

    if has_repeated {
        score = score.saturating_sub(1);
        feedback.push("Avoid repeated characters (e.g., 'aaa')".to_string());
    }

    let level = match score {
        0..=1 => PasswordStrengthLevel::VeryWeak,
        2 => PasswordStrengthLevel::Weak,
        3 => PasswordStrengthLevel::Fair,
        4 => PasswordStrengthLevel::Strong,
        _ => PasswordStrengthLevel::VeryStrong,
    };

    PasswordStrength {
        score,
        level,
        feedback,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PasswordStrength {
    pub score: u8,
    pub level: PasswordStrengthLevel,
    pub feedback: Vec<String>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PasswordStrengthLevel {
    VeryWeak,
    Weak,
    Fair,
    Strong,
    VeryStrong,
}

#[derive(Debug, thiserror::Error)]
pub enum PasswordError {
    #[error("Password hashing failed: {0}")]
    Hashing(String),
    #[error("Invalid password hash: {0}")]
    InvalidHash(String),
}

#[derive(Debug, thiserror::Error)]
pub enum PasswordValidationError {
    #[error("Password must be at least 12 characters")]
    TooShort,
    #[error("Password must be at most 128 characters")]
    TooLong,
    #[error("Password must contain at least one lowercase letter")]
    MissingLowercase,
    #[error("Password must contain at least one uppercase letter")]
    MissingUppercase,
    #[error("Password must contain at least one digit")]
    MissingDigit,
    #[error("Password must contain at least one special character (!@#$%^&*)")]
    MissingSpecialChar,
    #[error("This password is too common - please choose a unique password")]
    TooCommon,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "SecureP@ssw0rd123";
        let hash = hash_password(password).expect("Failed to hash password");

        assert!(verify_password(password, &hash).expect("Verification failed"));
        assert!(!verify_password("wrong_password", &hash).expect("Verification failed"));
    }

    #[test]
    fn test_password_validation() {
        // Too short
        assert!(matches!(
            validate_password_strength("Short1!"),
            Err(PasswordValidationError::TooShort)
        ));

        // No uppercase
        assert!(matches!(
            validate_password_strength("lowercase123!"),
            Err(PasswordValidationError::MissingUppercase)
        ));

        // No lowercase
        assert!(matches!(
            validate_password_strength("UPPERCASE123!"),
            Err(PasswordValidationError::MissingLowercase)
        ));

        // No digits
        assert!(matches!(
            validate_password_strength("NoDigitsHere!"),
            Err(PasswordValidationError::MissingDigit)
        ));

        // No special characters
        assert!(matches!(
            validate_password_strength("ValidPass123"),
            Err(PasswordValidationError::MissingSpecialChar)
        ));

        // Common password
        assert!(matches!(
            validate_password_strength("Password123!"),
            Err(PasswordValidationError::TooCommon)
        ));

        // Valid password
        assert!(validate_password_strength("MySecureP@ss123").is_ok());
    }

    #[test]
    fn test_common_password_detection() {
        // Common passwords from our blacklist (case-insensitive, exact match)
        // "password123!" is in the list (line 85)
        assert!(matches!(
            validate_password_strength("Password123!"),
            Err(PasswordValidationError::TooCommon)
        ));

        // "password@123" is in the list (line 105)
        assert!(matches!(
            validate_password_strength("Password@123"),
            Err(PasswordValidationError::TooCommon)
        ));

        // "password#123" is in the list (line 105)
        assert!(matches!(
            validate_password_strength("Password#123"),
            Err(PasswordValidationError::TooCommon)
        ));

        // Passwords not in exact match list should pass (if they meet other requirements)
        assert!(validate_password_strength("MyUniqueP@ssw0rd123").is_ok());
        assert!(validate_password_strength("Str0ngP@ssword!").is_ok());
    }

    #[test]
    fn test_password_strength_calculation() {
        // Very weak: common password
        let strength = calculate_password_strength("password123");
        assert_eq!(strength.level, PasswordStrengthLevel::VeryWeak);
        assert_eq!(strength.score, 0);

        // Weak: short, missing variety
        let strength = calculate_password_strength("Short1!");
        assert!(matches!(
            strength.level,
            PasswordStrengthLevel::VeryWeak | PasswordStrengthLevel::Weak
        ));

        // Fair: meets basic requirements (12+ chars, 3 types)
        let strength = calculate_password_strength("ValidPass123");
        assert_eq!(strength.level, PasswordStrengthLevel::Weak);
        assert_eq!(strength.score, 2);

        // Fair to Strong: 12+ chars, all 4 types
        let strength = calculate_password_strength("ValidPass123!");
        assert_eq!(strength.level, PasswordStrengthLevel::Fair);
        assert_eq!(strength.score, 3);

        // Strong: 16+ chars, all 4 types (score: 1+1+2 = 4)
        let strength = calculate_password_strength("MySecureP@ssw0rd123");
        assert_eq!(strength.level, PasswordStrengthLevel::Strong);
        assert_eq!(strength.score, 4);

        // Passwords with repeated characters get penalty
        let strength = calculate_password_strength("Paaassword123!");
        assert!(strength.score < 4); // Should be penalized
    }

    #[test]
    fn test_password_length_requirements() {
        // Less than 12 characters
        assert!(matches!(
            validate_password_strength("Short1!aB"),
            Err(PasswordValidationError::TooShort)
        ));

        // Exactly 12 characters (minimum)
        assert!(validate_password_strength("ValidPass1!a").is_ok());

        // More than 128 characters
        let long_password = "A".repeat(129) + "1!";
        assert!(matches!(
            validate_password_strength(&long_password),
            Err(PasswordValidationError::TooLong)
        ));
    }
}
