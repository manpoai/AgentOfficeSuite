import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { showError } from '@/lib/utils/error';

/**
 * A wrapper around useMutation that adds optimistic cache updates with rollback.
 *
 * Usage:
 *   const mut = useOptimisticMutation({
 *     mutationFn: (vars) => apiCall(vars),
 *     queryKey: ['comments', targetId],
 *     optimisticUpdate: (old, vars) => [...old, newComment],
 *     errorMessage: 'Failed to add comment',
 *   });
 */
export function useOptimisticMutation<TData, TVars>(opts: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  queryKey: QueryKey;
  optimisticUpdate: (oldData: TData | undefined, vars: TVars) => TData;
  onSuccess?: () => void;
  errorMessage?: string;
}) {
  const qc = useQueryClient();

  return useMutation<unknown, Error, TVars, { previous?: TData }>({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: opts.queryKey });
      const previous = qc.getQueryData<TData>(opts.queryKey);
      qc.setQueryData<TData>(opts.queryKey, (old) => opts.optimisticUpdate(old, vars));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(opts.queryKey, context.previous);
      }
      showError(opts.errorMessage ?? 'Operation failed', _err);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: opts.queryKey });
      opts.onSuccess?.();
    },
  });
}
