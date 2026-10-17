import { useState } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, signup } = useAuth();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ description: 'Please enter email and password', variant: 'destructive' });
      return;
    }

    const mutation = isLogin ? login : signup;
    mutation.mutate({ email, password }, {
      onError: (err: any) => {
        toast({ description: err.message, variant: 'destructive' });
      }
    });
  };

  return (
    <div className="w-screen min-h-[100dvh] flex items-center justify-center title-screen-bg relative p-4">
      <div className="absolute top-6 left-6 z-10">
        <Link href="/" className="px-6 py-2 bg-black/50 border border-[#8b3d20] text-[#ffcc88] uppercase tracking-wider font-bold rounded hover:bg-[#8b3d20] transition-colors">
          &larr; Back to Game
        </Link>
      </div>

      <div className="w-full max-w-md hud-panel p-8 rounded-xl z-10">
        <h2 className="text-3xl font-black western-title uppercase text-center mb-2 text-[#ffcc88]">
          {isLogin ? 'Saloon Login' : 'Join the Posse'}
        </h2>
        <p className="text-center text-[#bba088] mb-8 font-serif italic">
          {isLogin ? 'Saddle up and place yer bets.' : 'Sign up for a fresh stake.'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block uppercase tracking-widest text-[#ddaa77] text-sm font-bold mb-2">Email Address</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/40 border border-[#8b3d20] rounded px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#ffaa55] transition-all"
              placeholder="cowboy@trails.com"
            />
          </div>
          <div>
            <label className="block uppercase tracking-widest text-[#ddaa77] text-sm font-bold mb-2">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/40 border border-[#8b3d20] rounded px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#ffaa55] transition-all"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit"
            disabled={login.isPending || signup.isPending}
            className="w-full mt-4 px-6 py-4 bg-[#8b3d20] hover:bg-[#aa4b28] text-white text-xl font-bold rounded shadow-[0_0_15px_rgba(255,100,50,0.3)] transition-all uppercase tracking-widest disabled:opacity-50"
          >
            {login.isPending || signup.isPending ? 'Waitin...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            type="button" 
            onClick={() => setIsLogin(!isLogin)}
            className="text-[#ffaa55] hover:text-white transition-colors underline-offset-4 hover:underline text-sm uppercase tracking-wide"
          >
            {isLogin ? "Need an account? Sign up" : "Already riding? Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
