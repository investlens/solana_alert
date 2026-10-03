-- Register functional feed preference keys; preserve all existing choices.
insert into public.strategy_registry(strategy_key,name,chain,category,enabled,user_visible,default_user_enabled,execution_mode,default_action) values
('RH_BOOST','Boost','robinhood','discovery',true,true,true,'manual','WATCH'),
('RH_SOCIAL_MAFIA','Social Mafia','robinhood','discovery',true,true,true,'manual','WATCH'),
('RH_PROTOCOL_DISCOVERY','Protocol Discovery','robinhood','discovery',true,true,true,'manual','WATCH'),
('RH_TRADE_SETUP','Trade Setup','robinhood','momentum',true,true,true,'manual','WATCH'),
('RH_MOMENTUM','PONS Momentum','robinhood','momentum',true,true,true,'manual','WATCH'),
('RH_SUPPLY_BURN','Supply Burn','robinhood','discovery',true,true,true,'manual','WATCH'),
('ARC_BOOST','Boost','arc','discovery',true,true,true,'manual','WATCH'),
('ARC_OPPORTUNITY','Opportunity','arc','momentum',true,true,true,'manual','WATCH'),
('ARC_SUPPLY_BURN','Supply Burn','arc','discovery',true,true,true,'manual','WATCH')
on conflict(strategy_key) do nothing;
