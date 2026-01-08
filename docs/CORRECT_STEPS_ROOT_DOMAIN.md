# Correct Steps to Add plexmcp.com (Root Domain)

## The Problem You Hit

You tried to add DNS records for `resend._domainkey.mail` but:
- ❌ That record ALREADY EXISTS (for mail.plexmcp.com subdomain)
- ❌ You need records for the ROOT domain, not the subdomain

## What You Currently Have

✅ **mail.plexmcp.com** (subdomain) - Verified
- DNS Records: `resend._domainkey.mail`, `send.mail`, etc.
- Can send from: `anything@mail.plexmcp.com`

## What You Need to Add

⚠️ **plexmcp.com** (root domain) - NOT YET ADDED
- DNS Records: `resend._domainkey`, `send`, etc. (NO .mail suffix!)
- Will send from: `anything@plexmcp.com`

## Correct Steps

### Step 1: Add Root Domain in Resend

1. Go to Resend Domains: https://resend.com/domains
2. Click **"Add Domain"** button
3. Enter: **`plexmcp.com`** (just the root domain, no subdomain)
4. Select region: **North Virginia (us-east-1)** (same as your subdomain)
5. Click **"Add"**

**IMPORTANT:** This creates a SEPARATE domain entry from your existing `mail.plexmcp.com`

### Step 2: Get DNS Records from Resend

After adding the domain, Resend will show you DNS records. They should look like:

**DKIM (Domain Verification):**
```
Type: TXT
Name: resend._domainkey
Value: p=MIG... (different from your mail subdomain!)
```

**SPF TXT (Enable Sending):**
```
Type: TXT
Name: send
Value: v=spf1 include:amazonses.com ~all
```

**SPF MX (Enable Sending):**
```
Type: MX
Name: send
Value: feedback-smtp.us-east-1.amazonses.com
Priority: 10
```

### Step 3: Add DNS Records to Vercel

**CRITICAL:** These records are DIFFERENT from your subdomain records!

| Your Subdomain Records | New Root Domain Records |
|------------------------|-------------------------|
| `resend._domainkey.mail` | `resend._domainkey` |
| `send.mail` | `send` |

#### Add Record 1: DKIM
1. In Vercel DNS page: Click **"Add Record"**
2. Type: **TXT**
3. Name: **`resend._domainkey`** (NO .mail!)
4. Value: Copy from Resend (the NEW value, not your existing one)
5. Click **"Add"**

#### Add Record 2: SPF TXT
1. Click **"Add Record"**
2. Type: **TXT**
3. Name: **`send`** (NO .mail!)
4. Value: Copy from Resend
5. Click **"Add"**

#### Add Record 3: SPF MX
1. Click **"Add Record"**
2. Type: **MX**
3. Name: **`send`** (NO .mail!)
4. Value: `feedback-smtp.us-east-1.amazonses.com`
5. Priority: **10**
6. Click **"Add"**

### Step 4: Verify

After 15-60 minutes:
1. Go back to Resend domains
2. Click on **`plexmcp.com`** (not mail.plexmcp.com)
3. Check that all records show "Verified" ✅

## Visual Comparison

### What You'll Have After This:

```
Resend Domains:
├── mail.plexmcp.com ✅ (already exists)
│   └── Can send from: noreply@mail.plexmcp.com
│
└── plexmcp.com ✅ (new - what you're adding)
    └── Can send from: noreply@plexmcp.com
```

### Vercel DNS Records:

```
plexmcp.com DNS:
├── resend._domainkey.mail → (existing - for subdomain)
├── send.mail → (existing - for subdomain)
├── mail → (existing - for subdomain)
│
├── resend._domainkey → (NEW - for root domain)
├── send (TXT) → (NEW - for root domain)
└── send (MX) → (NEW - for root domain)
```

## Common Mistakes to Avoid

❌ **DON'T** try to modify existing `resend._domainkey.mail` record
❌ **DON'T** use `.mail` suffix in the new records
❌ **DON'T** delete your existing subdomain records
✅ **DO** add plexmcp.com as a SEPARATE domain in Resend first
✅ **DO** use plain names: `resend._domainkey`, `send` (no suffix)
✅ **DO** keep both domains (subdomain AND root domain)

## Troubleshooting

### "DNS record already exists" error
- You're trying to add a record that already exists for the subdomain
- Make sure you're adding records WITHOUT the `.mail` suffix

### "Wildcard Domain Override" warning
- This appears if you try to add `resend._domainkey.mail` again
- Click **Cancel** and use the correct name instead

### Can't find where to add plexmcp.com in Resend
- Make sure you're on https://resend.com/domains
- Click "Add Domain" button (top right)
- Enter just `plexmcp.com` (not a subdomain)

## Final State

After completing these steps, you'll have:

**Existing (unchanged):**
- ✅ `mail.plexmcp.com` verified
- ✅ Can send from `*@mail.plexmcp.com`

**New (what you're adding):**
- ✅ `plexmcp.com` verified
- ✅ Can send from `*@plexmcp.com` ← This is what you want!

Both will work independently!
