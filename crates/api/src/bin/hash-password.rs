#!/usr/bin/env cargo
//! Password hashing utility for PlexMCP
//!
//! Generates Argon2id password hashes for secure storage in the database.
//! This is used for creating admin accounts manually without exposing plaintext passwords.
//!
//! Usage:
//!   cargo run --bin hash-password
//!   cargo run --bin hash-password "MySecurePassword123!"
//!
//! Security:
//! - Uses Argon2id (recommended by OWASP)
//! - Salts are automatically generated and embedded in the hash
//! - Hash format: $argon2id$v=19$m=19456,t=2,p=1$...
//!
//! Example output:
//!   $argon2id$v=19$m=19456,t=2,p=1$SomeRandomSalt$HashOfPassword

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use std::env;
use std::io::{self, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let password = if let Some(pwd) = env::args().nth(1) {
        // Password provided as argument
        pwd
    } else {
        // Read password from stdin (more secure - doesn't show in process list)
        print!("Enter password to hash: ");
        io::stdout().flush()?;

        let mut password = String::new();
        io::stdin().read_line(&mut password)?;
        password.trim().to_string()
    };

    if password.is_empty() {
        eprintln!("Error: Password cannot be empty");
        std::process::exit(1);
    }

    // Validate password strength (basic check)
    if password.len() < 12 {
        eprintln!("Warning: Password is less than 12 characters. Consider using a longer password.");
    }

    // Generate salt
    let salt = SaltString::generate(&mut OsRng);

    // Hash password with Argon2id (OWASP recommended)
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?
        .to_string();

    println!("\n===========================================");
    println!("Password Hash (Argon2id):");
    println!("===========================================");
    println!("{}", password_hash);
    println!("===========================================\n");

    println!("Usage:");
    println!("1. Copy the hash above");
    println!("2. Store it in the 'password_hash' column of the 'users' table");
    println!("\nExample SQL:");
    println!("UPDATE users SET password_hash = '{}' WHERE email = 'admin@example.com';", password_hash);

    Ok(())
}
