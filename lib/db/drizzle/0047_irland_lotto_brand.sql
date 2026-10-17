-- Display branding only; prices, balances, seeds and existing IDs stay intact.
UPDATE lottery_settings
SET value = jsonb_set(value, '{brand}', '"Irland Lotto"'::jsonb),
    version = version + 1
WHERE value->>'brand' IS DISTINCT FROM 'Irland Lotto';
--> statement-breakpoint
UPDATE lottery_draws
SET config = jsonb_set(config, '{brand}', '"Irland Lotto"'::jsonb)
WHERE config->>'brand' IS DISTINCT FROM 'Irland Lotto';
