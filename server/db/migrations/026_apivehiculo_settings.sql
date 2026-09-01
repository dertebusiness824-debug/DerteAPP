-- Rename the stored plate-API key away from the retired provider.
UPDATE platform_settings
   SET key = 'apivehiculo_api_key',
       updated_at = now()
 WHERE key = 'matriculas_api_key'
   AND NOT EXISTS (
     SELECT 1 FROM platform_settings existing WHERE existing.key = 'apivehiculo_api_key'
   );

DELETE FROM platform_settings WHERE key = 'matriculas_api_key';
