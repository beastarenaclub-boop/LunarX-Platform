-- Change future roulette terms only; accepted rounds retain their JSON snapshot.
UPDATE game_config
SET house_edge = 1.0 / 37.0,
    rtp_min = 3600.0 / 37.0,
    rtp_max = 3600.0 / 37.0,
    max_multiplier = 36,
    min_stake_paise = 1000,
    settlement_mode = 'house_edge',
    updated_at = now()
WHERE game_code = 'roulette';
