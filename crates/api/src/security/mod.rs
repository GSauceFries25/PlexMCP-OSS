//! Security validation and compliance testing module
//!
//! This module contains tests and utilities for validating security controls
//! required for SOC 2 Type II compliance.

mod headers;

pub use headers::security_headers_middleware;

#[cfg(test)]
mod rls_tests;
