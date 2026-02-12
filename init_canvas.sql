-- Canvas Initialization Script for Winter Paintboard (720x405)
-- Run this script in your Supabase SQL Editor.

-- WARNING: This will clear the existing canvas!
TRUNCATE TABLE public.pixels;

DO $$
BEGIN
    RAISE NOTICE 'Initializing canvas with testing pattern...';

    -- Efficiently insert pixels
    -- Canvas Size: 720 x 405
    -- Center Rectangle: Red (#FF0000), Size 200x100
    -- Center X: 360, Center Y: 202
    -- Rect X Range: 260 to 460
    -- Rect Y Range: 152 to 252

    INSERT INTO public.pixels (x, y, color, updated_at)
    SELECT 
        x, 
        y, 
        CASE 
            WHEN (x BETWEEN 260 AND 460) AND (y BETWEEN 152 AND 252) THEN '#FF0000' -- Red Center
            ELSE '#FFFFFF' -- White Background
        END as color,
        now() as updated_at
    FROM 
        generate_series(0, 719) as x,
        generate_series(0, 404) as y;
        
    RAISE NOTICE 'Canvas initialized with test pattern.';
END $$;

-- Verify count (Should be 291600)
SELECT count(*) FROM public.pixels;
