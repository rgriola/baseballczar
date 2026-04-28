'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionTeam } from '@/lib/provisioning';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signupSchema = loginSchema.extend({
  teamName: z.string().min(2, 'Team name must be at least 2 characters').max(40),
});

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signup(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    teamName: formData.get('teamName'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { team_name: parsed.data.teamName },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is required, don't redirect to dashboard
  if (data.user && !data.session) {
    return { success: 'Check your email for a confirmation link.' };
  }

  // Provision team for new user
  if (data.user) {
    try {
      const serviceClient = createServiceClient();
      await provisionTeam(serviceClient, data.user.id, parsed.data.teamName);
    } catch (e) {
      console.error('Team provisioning failed:', e);
      // Don't block signup — user can still log in; provisioning can be retried
    }
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function resetPassword(formData: FormData) {
  const email = z.string().email().safeParse(formData.get('email'));

  if (!email.success) {
    return { error: 'Invalid email address' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/dashboard`,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: 'Check your email for a password reset link.' };
}
