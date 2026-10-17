import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAuthMe, login, signup, logout } from '../lib/api';
import { useLocation } from 'wouter';

export function useAuth() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchAuthMe,
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data.user || data);
      setLocation('/race');
    },
  });

  const signupMutation = useMutation({
    mutationFn: signup,
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data.user || data);
      setLocation('/race');
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], null);
      setLocation('/');
    },
  });

  return {
    user: user?.user || user || null,
    isLoading,
    login: loginMutation,
    signup: signupMutation,
    logout: logoutMutation,
  };
}
