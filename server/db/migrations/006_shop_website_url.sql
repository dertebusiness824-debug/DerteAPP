-- Optional Hostinger panel / website URL embedded in the shop-owner "Web" tab.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS website_url TEXT;
