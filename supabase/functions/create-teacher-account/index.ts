// supabase/functions/create-teacher-account/index.ts
import { serve } from "https://deno.land/std@0.131.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing environment secrets: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { code, prefix, firstName, lastName, assignedGrades, assignedClassrooms, password } = await req.json();

    if (!code || !firstName || !lastName || !password) {
      return new Response(JSON.stringify({ error: "Missing parameters: code, firstName, lastName, and password are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. Check if teacher code already exists in teachers table
    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('code')
      .eq('code', code)
      .maybeSingle();

    if (existingTeacher) {
      return new Response(JSON.stringify({ error: "มีรหัสประจำตัวคุณครูนี้ในระบบแล้ว" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Create User in auth.users
    const email = `${code}@teacher.readinglog`;
    let authId: string | null = null;

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: password,
      user_metadata: { role: 'teacher' },
      email_confirm: true
    });

    if (authError) {
      // Check if the user already exists in auth.users
      if (authError.message.includes('already been registered') || authError.status === 422) {
        // Retrieve the existing user by listing users
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
          perPage: 1000
        });
        if (listError) {
          throw new Error(`Auth lookup failed: ${listError.message}`);
        }
        const existingUser = listData?.users?.find(u => u.email === email);
        if (existingUser) {
          authId = existingUser.id;
          // Update password and metadata for the existing user
          const { error: updateError } = await supabase.auth.admin.updateUserById(authId, {
            password: password,
            user_metadata: { role: 'teacher' }
          });
          if (updateError) {
            throw new Error(`Auth update failed: ${updateError.message}`);
          }
        } else {
          throw new Error(`Auth conflict: user exists but could not be located in user directory.`);
        }
      } else {
        throw new Error(`Auth account creation failed: ${authError.message}`);
      }
    } else if (authUser?.user) {
      authId = authUser.user.id;
    }

    if (!authId) {
      throw new Error("Failed to determine Auth User ID.");
    }

    // 3. Upsert into teachers table
    const name = [prefix, firstName, lastName].filter(Boolean).join(' ');
    const { error: insertError } = await supabase
      .from('teachers')
      .upsert({
        id: authId,
        code,
        name,
        assigned_level: assignedGrades[0] || 'ม.1',
        assigned_grades: assignedGrades,
        assigned_classrooms: assignedClassrooms,
        role: 'teacher'
      });

    if (insertError) {
      throw new Error(`Teacher profile creation failed: ${insertError.message}`);
    }

    return new Response(JSON.stringify({ success: true, message: "เพิ่มบัญชีคุณครูเรียบร้อยแล้ว!" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
