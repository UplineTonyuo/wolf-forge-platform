-- Wolf Forge Platform
-- Fix company wallet permission trigger.
--
-- The trigger is shared by company_wallets and
-- company_wallet_transactions. The previous implementation accessed
-- NEW.balance_cents before isolating the company_wallets branch.
-- company_wallet_transactions has no balance_cents column, causing
-- wallet adjustments to fail while inserting the ledger transaction.

create or replace function private.enforce_company_wallet_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Company creation provisions a zero-balance wallet through the
  -- database-owned companies_create_wallet trigger.
  --
  -- Only inspect balance_cents when this trigger is actually executing
  -- for public.company_wallets.
  if tg_table_name = 'company_wallets' then
    if tg_op = 'INSERT' then
      if new.balance_cents = 0 then
        return new;
      end if;
    end if;
  end if;

  -- All authenticated wallet mutations require the explicit
  -- client-private management capability.
  if (select auth.uid()) is not null then
    perform private.require_permission('client_private.manage');
  end if;

  -- BEFORE DELETE triggers must return OLD.
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;