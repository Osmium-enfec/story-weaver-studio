DELETE FROM public.animation_components
WHERE name IN (
  'Variable Box','For Loop','If Else Branch','Function Call','Class Diagram',
  'API Request','Database Table','Code Block','Terminal Output','Android Activity'
) AND (provider IS NULL OR provider = 'internal');