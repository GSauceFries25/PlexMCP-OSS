# PlexMCP Email Wildcard Setup Guide

## Problem
Emails sent from plexmcp.com addresses are failing or not working with wildcard support. You want to be able to send from ANY email address at plexmcp.com (noreply@, support@, billing@, etc.).

## Root Cause
Currently, emails can only be sent from **verified individual email addresses** in Resend. To enable wildcard support (sending from ANY address at your domain), you need to **verify the entire domain** instead.

## Solution: Verify plexmcp.com Domain in Resend

### Step 1: Check Current Domain Status

Run this command to see your current Resend configuration:

```bash
# Export your Resend API key first (get it from Fly.io)
export RESEND_API_KEY=re_your_key_here

# Check domain status
./check-resend-domain.sh
```

### Step 2: Add Domain to Resend (if not already added)

1. Go to **Resend Dashboard**: https://resend.com/domains
2. Click **"Add Domain"**
3. Enter: `plexmcp.com`
4. Select region (choose closest to your users)

### Step 3: Add DNS Records

Resend will provide you with 3 DNS records to add to your domain registrar:

#### SPF Record (TXT)
```
Type: TXT
Name: @
Value: v=spf1 include:resend.com ~all
```

#### DKIM Record (TXT)
```
Type: TXT
Name: resend._domainkey
Value: [Resend will provide this unique value]
```

#### DMARC Record (TXT - Optional but Recommended)
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@plexmcp.com
```

### Step 4: Wait for Verification

- DNS propagation typically takes 15 minutes to 1 hour
- Resend will automatically verify once DNS records are detected
- You'll receive an email confirmation when verified

### Step 5: Test Wildcard Email Sending

Once verified, test sending from different addresses:

```bash
export RESEND_API_KEY=re_your_key_here
./test-email-wildcard.sh
```

This will test sending from:
- `noreply@plexmcp.com` ✅
- `support@plexmcp.com` ✅
- `billing@plexmcp.com` ✅
- **ANY other address @plexmcp.com** ✅

## How It Works

### Before Domain Verification
- ❌ Can only send from: `noreply@plexmcp.com` (if individually verified)
- ❌ Cannot send from: `support@plexmcp.com`, `billing@plexmcp.com`, etc.

### After Domain Verification
- ✅ Can send from **ANY** address: `anything@plexmcp.com`
- ✅ No need to verify individual email addresses
- ✅ Better deliverability with proper SPF/DKIM/DMARC

## Current PlexMCP Configuration

The PlexMCP system uses a single `EMAIL_FROM` environment variable:

```bash
EMAIL_FROM=PlexMCP <noreply@plexmcp.com>
```

### Making It More Flexible (Optional Enhancement)

If you want to send from different addresses based on context, you can modify the code:

**Example: Send billing emails from billing@plexmcp.com**

```rust
// In crates/billing/src/email.rs
pub struct EmailConfig {
    pub resend_api_key: String,
    pub email_from_noreply: String,      // noreply@plexmcp.com
    pub email_from_support: String,      // support@plexmcp.com
    pub email_from_billing: String,      // billing@plexmcp.com
}

// Use appropriate sender based on email type
async fn send_payment_failed(...) {
    let from = &self.config.email_from_billing; // Use billing@ for payment emails
    // ...
}
```

## Troubleshooting

### Error: "Domain not verified"
- Check DNS records are correctly added
- Wait up to 1 hour for DNS propagation
- Use `dig` to verify DNS records:
  ```bash
  dig TXT plexmcp.com
  dig TXT resend._domainkey.plexmcp.com
  ```

### Error: "Unauthorized sender"
- Domain verification is still pending
- Check Resend dashboard for verification status

### Emails go to spam
- Ensure all 3 DNS records (SPF, DKIM, DMARC) are added
- Use https://mail-tester.com to check email quality score
- Warm up your domain by sending low volumes initially

## Production Checklist

- [ ] plexmcp.com domain added to Resend
- [ ] SPF record added to DNS
- [ ] DKIM record added to DNS
- [ ] DMARC record added to DNS
- [ ] Domain shows "Verified" in Resend dashboard
- [ ] Test emails sent successfully from multiple addresses
- [ ] EMAIL_FROM environment variable set in Fly.io
- [ ] RESEND_API_KEY environment variable set in Fly.io
- [ ] Email deliverability tested (check spam folders)

## Related Files

- `crates/billing/src/email.rs` - Billing email service
- `crates/api/src/email.rs` - General email service
- `crates/api/src/routes/pin.rs` - PIN reset emails
- `.env.example` - Email environment variable examples

## Support

If you continue to have issues:
1. Check Resend dashboard: https://resend.com/domains
2. Review Resend logs: https://resend.com/logs
3. Contact Resend support: support@resend.com
