import { useQuery } from '@tanstack/react-query';
import { fetchWalletBalance } from '../lib/api';
import { useAuth } from './use-auth';

export function useWallet() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: fetchWalletBalance,
    enabled: !!user,
    staleTime: 0, // shared across every game
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
  });
}
