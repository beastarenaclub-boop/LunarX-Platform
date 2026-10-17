import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRacingConfig, playRacingBet } from '../lib/api';

export function useRacingConfig() {
  return useQuery({
    queryKey: ['racing', 'config'],
    queryFn: fetchRacingConfig,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRacingBet() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: { stakeAmount: string; horseId: number; stateId: string }) =>
      playRacingBet(params.stakeAmount, params.horseId, params.stateId),
    onSuccess: () => {
      // Refresh wallet balance on a successful bet
      queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
    },
  });
}
