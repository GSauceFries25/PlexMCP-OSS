# Adding Resend DNS Records to Vercel

## Overview
Since you purchased `plexmcp.com` through Vercel, you need to add the Resend DNS records in Vercel's DNS management interface.

## Step-by-Step Instructions

### 1. Access Vercel DNS Management

1. Go to **Vercel Dashboard**: https://vercel.com/dashboard
2. Navigate to **Domains** or go directly to: https://vercel.com/domains
3. Click on `plexmcp.com` to manage it
4. Look for **DNS Records** or **DNS** tab

### 2. Add DKIM Record (Domain Verification) ⚠️ REQUIRED

This verifies your domain with Resend.

**Record Details:**
- **Type**: `TXT`
- **Name**: `resend._domainkey` (or just `resend._domainkey` - Vercel will handle the domain suffix)
- **Value**: `p=MIGfMA0GCSqGSIb3DQEB...` (copy the full value from Resend)
- **TTL**: Auto or 3600

**In Vercel:**
1. Click **Add Record** or **Add DNS Record**
2. Select **TXT** as type
3. Enter name: `resend._domainkey`
4. Paste the full DKIM value from Resend (starts with `p=MIG...`)
5. Save

### 3. Add SPF TXT Record (Enable Sending) ⚠️ REQUIRED

This allows sending emails through Resend.

**Record Details:**
- **Type**: `TXT`
- **Name**: `send`
- **Value**: `v=spf1 include:amazons...` (copy full value from Resend)
- **TTL**: Auto or 3600

**In Vercel:**
1. Click **Add Record**
2. Select **TXT** as type
3. Enter name: `send`
4. Paste the SPF value from Resend (starts with `v=spf1...`)
5. Save

### 4. Add SPF MX Record (Enable Sending) ⚠️ REQUIRED

This is for bounce handling.

**Record Details:**
- **Type**: `MX`
- **Name**: `send`
- **Value**: `feedback-smtp.us-east-...` (copy from Resend)
- **Priority**: `10`
- **TTL**: Auto or 3600

**In Vercel:**
1. Click **Add Record**
2. Select **MX** as type
3. Enter name: `send`
4. Enter mail server: `feedback-smtp.us-east-...` (copy from Resend)
5. Set priority: `10`
6. Save

### 5. Add MX Record for Receiving (OPTIONAL)

⚠️ **Only add this if you want to RECEIVE emails at plexmcp.com addresses**

If you only want to SEND emails (not receive), you can skip this record.

**Record Details:**
- **Type**: `MX`
- **Name**: `@` (or leave blank - represents root domain)
- **Value**: `inbound-smtp.us-east-1...` (copy from Resend)
- **Priority**: `10`

**In Vercel:**
1. Click **Add Record**
2. Select **MX** as type
3. Enter name: `@` or leave blank
4. Enter mail server: `inbound-smtp.us-east-1...`
5. Set priority: `10`
6. Save

## Important Notes

### Vercel DNS Format
- Vercel might automatically append `.plexmcp.com` to your record names
- If you see the full domain in the name field (e.g., `send.plexmcp.com`), just use `send`
- The `@` symbol represents the root domain (`plexmcp.com`)

### TTL (Time To Live)
- Use **Auto** or **3600** (1 hour)
- Lower TTL = faster propagation but more DNS queries

### DNS Propagation Time
- Typically: **15 minutes to 1 hour**
- Can take up to 24-48 hours in rare cases
- Check status in Resend dashboard

## Verification Steps

### 1. Check DNS Records are Added in Vercel

After adding, you should see these records in Vercel:

| Type | Name | Value |
|------|------|-------|
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEB... |
| TXT | send | v=spf1 include:amazons... |
| MX | send | feedback-smtp.us-east-... (Priority: 10) |
| MX | @ | inbound-smtp.us-east-1... (Priority: 10) *(optional)* |

### 2. Wait for DNS Propagation

Check propagation with these commands:

```bash
# Check DKIM record
dig TXT resend._domainkey.plexmcp.com

# Check SPF record
dig TXT send.plexmcp.com

# Check MX records
dig MX send.plexmcp.com
dig MX plexmcp.com
```

Or use online tools:
- https://dnschecker.org
- https://mxtoolbox.com/SuperTool.aspx

### 3. Verify in Resend Dashboard

1. Go back to Resend: https://resend.com/domains
2. Click on `plexmcp.com`
3. Wait for **Status** to change from "Pending" to "Verified"
4. All records should show green checkmarks ✓

### 4. Test Email Sending

Once verified, test wildcard email sending:

```bash
cd /Users/tylermailman/Documents/GitHub/PlexMCP
export RESEND_API_KEY=re_your_key_here
./test-email-wildcard.sh
```

## Troubleshooting

### Records showing "Pending" in Resend
- DNS propagation still in progress
- Wait 15-60 minutes
- Check DNS propagation with `dig` commands above

### "Record not found" when checking with dig
- DNS not propagated yet
- Check if record was added correctly in Vercel
- Verify record name and value match exactly

### Vercel not showing DNS tab
- Ensure domain is managed by Vercel nameservers
- Check domain settings in Vercel dashboard
- Contact Vercel support if needed

### Can't add MX record in Vercel
- Some Vercel plans might have limitations
- Try using Vercel CLI: `vercel dns add plexmcp.com send MX feedback-smtp.us-east-1.amazonses.com 10`

## Alternative: Use Vercel CLI

If you prefer command-line, you can add DNS records using Vercel CLI:

```bash
# Install Vercel CLI if not installed
npm i -g vercel

# Login
vercel login

# Add DKIM record
vercel dns add plexmcp.com 'resend._domainkey' TXT 'p=MIGfMA0GCSqGSIb3DQEB...'

# Add SPF TXT record
vercel dns add plexmcp.com send TXT 'v=spf1 include:amazons...'

# Add SPF MX record
vercel dns add plexmcp.com send MX 'feedback-smtp.us-east-1.amazonses.com' 10

# List all DNS records to verify
vercel dns ls plexmcp.com
```

## Complete Checklist

- [ ] Access Vercel Domains dashboard
- [ ] Navigate to plexmcp.com DNS settings
- [ ] Add DKIM TXT record (resend._domainkey)
- [ ] Add SPF TXT record (send)
- [ ] Add SPF MX record (send)
- [ ] Add receiving MX record @ (optional)
- [ ] Wait 15-60 minutes for DNS propagation
- [ ] Check DNS propagation with dig or online tools
- [ ] Verify "Verified" status in Resend dashboard
- [ ] Test email sending with test-email-wildcard.sh
- [ ] Confirm emails can be sent from any @plexmcp.com address

## Support Resources

- **Vercel DNS Docs**: https://vercel.com/docs/projects/domains/managing-dns-records
- **Resend Docs**: https://resend.com/docs/dashboard/domains/introduction
- **DNS Checker**: https://dnschecker.org
- **MX Toolbox**: https://mxtoolbox.com/SuperTool.aspx
