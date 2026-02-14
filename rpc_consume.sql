-- RPC: Atomic Token Consumption with Refill Logic
-- Solves race conditions during rapid requests (dragging/AutoPaint)
-- Batch Mode: p_amount default 1
create or replace function consume_with_refill(
  p_user_id uuid,
  p_amount int default 1
) returns jsonb as $$
declare
  v_profile profiles%rowtype;
  v_now timestamptz := now();
  v_last_update timestamptz;
  v_diff_ms bigint;
  v_ticks int;
  v_count int;
  v_multiplier int;
  v_add_tokens int;
  v_new_tokens int;
  v_remainder_ms bigint;
  v_new_update timestamptz;
begin
  -- Lock the user row for update to prevent concurrent access
  select * into v_profile from profiles where id = p_user_id for update;
  
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  v_last_update := coalesce(v_profile.last_token_update, v_now);
  -- Calculate time passed in milliseconds
  v_diff_ms := extract(epoch from (v_now - v_last_update)) * 1000;
  v_ticks := floor(v_diff_ms / 1000); -- 1000ms rate (1s per token)
  
  -- Update Timestamp Logic (consume full 1000ms chunks)
  if v_ticks > 0 then
      v_remainder_ms := v_diff_ms % 1000;
      v_new_update := v_now - (v_remainder_ms || ' milliseconds')::interval;
  else
      v_new_update := v_last_update;
  end if;

  -- Delegation Logic: Check if I am a Delegator
  if v_profile.token_yield_beneficiary is not null then
      -- I am delegating. My production is halted (0 gain).
      -- Just update time to consume the ticks.
      update profiles 
      set last_token_update = v_new_update
      where id = p_user_id;
      
      -- Attempt Consumption
      if v_profile.tokens >= p_amount then
          update profiles set tokens = tokens - p_amount where id = p_user_id;
          return jsonb_build_object('success', true, 'remaining', v_profile.tokens - p_amount);
      else
          return jsonb_build_object('success', false, 'remaining', v_profile.tokens);
      end if;
  end if;

  -- Normal Logic: Check if I am a Beneficiary (Count Delegators)
  select count(*) into v_count from profiles where token_yield_beneficiary = v_profile.username;
  v_multiplier := 1 + coalesce(v_count, 0);
  
  v_add_tokens := v_ticks * v_multiplier;
  
  v_new_tokens := LEAST(300, v_profile.tokens + v_add_tokens);
  
  -- Attempt Consumption
  if v_new_tokens >= p_amount then
      update profiles 
      set tokens = v_new_tokens - p_amount,
          last_token_update = v_new_update
      where id = p_user_id;
      return jsonb_build_object('success', true, 'remaining', v_new_tokens - p_amount);
  else
      -- Not enough tokens. Update refill status anyway.
      update profiles 
      set tokens = v_new_tokens,
          last_token_update = v_new_update
      where id = p_user_id;
      return jsonb_build_object('success', false, 'remaining', v_new_tokens);
  end if;
end;
$$ language plpgsql;
