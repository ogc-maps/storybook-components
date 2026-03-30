import { safeValidateMapConfig } from '../../schemas/config';

export interface ConfigPreviewProps {
  config: unknown;
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  const result = safeValidateMapConfig(config);

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      <div className="mapui:flex mapui:items-center mapui:gap-2">
        <span
          className={[
            'mapui:inline-flex mapui:items-center mapui:rounded-full mapui:px-2.5 mapui:py-0.5 mapui:text-xs mapui:font-semibold',
            result.success
              ? 'mapui:bg-green-100 mapui:text-green-800'
              : 'mapui:bg-red-100 mapui:text-red-800',
          ].join(' ')}
        >
          {result.success ? 'Valid' : 'Invalid'}
        </span>
        <span className="mapui:text-xs mapui:text-gray-500">MapConfig validation</span>
      </div>

      {!result.success && (
        <div className="mapui:rounded mapui:bg-red-50 mapui:p-3">
          <p className="mapui:m-0 mapui:mb-1 mapui:text-xs mapui:font-semibold mapui:text-red-700">
            Validation Errors
          </p>
          <ul className="mapui:m-0 mapui:list-none mapui:flex mapui:flex-col mapui:gap-1 mapui:p-0">
            {result.error.issues.map((err, i) => (
              <li key={i} className="mapui:flex mapui:flex-col mapui:gap-0.5">
                <span className="mapui:font-mono mapui:text-xs mapui:text-red-600">
                  {err.path.join(' > ') || 'root'}
                </span>
                <span className="mapui:text-xs mapui:text-red-800">{err.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mapui:overflow-auto mapui:rounded mapui:border mapui:border-gray-200 mapui:bg-gray-50">
        <pre className="mapui:m-0 mapui:p-3 mapui:text-xs mapui:text-gray-800 mapui:whitespace-pre">
          {JSON.stringify(config, null, 2)}
        </pre>
      </div>
    </div>
  );
}
