import { Navigate, Route, Routes } from 'react-router-dom';
import type { Role } from '@cm/shared';
import { homeFor, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';

import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Profile } from './pages/Profile';

import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminUsers } from './pages/admin/Users';
import { AdminClasses } from './pages/admin/Classes';
import { AdminClassDetail } from './pages/admin/ClassDetail';
import { AdminRequests } from './pages/admin/Requests';
import { AdminDatabase } from './pages/admin/Database';

import { TeacherSchedule } from './pages/teacher/Schedule';
import { TeacherClasses } from './pages/teacher/Classes';
import { TeacherSession } from './pages/teacher/Session';
import { TeacherRequests } from './pages/teacher/Requests';

import { StudentSchedule } from './pages/student/Schedule';
import { StudentCatalog } from './pages/student/Catalog';
import { StudentTeachers } from './pages/student/Teachers';
import { StudentClasses } from './pages/student/Classes';
import { StudentAttendance } from './pages/student/Attendance';

/** Blocks a route until the user is signed in and holds one of `roles`. */
function Guard({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading what="your account" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor[user.role]} replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<Layout />}>
        <Route path="/profile" element={<Guard roles={['ADMIN', 'TEACHER', 'STUDENT']}><Profile /></Guard>} />

        <Route path="/admin" element={<Guard roles={['ADMIN']}><AdminDashboard /></Guard>} />
        <Route path="/admin/users" element={<Guard roles={['ADMIN']}><AdminUsers /></Guard>} />
        <Route path="/admin/classes" element={<Guard roles={['ADMIN']}><AdminClasses /></Guard>} />
        <Route path="/admin/classes/:id" element={<Guard roles={['ADMIN']}><AdminClassDetail /></Guard>} />
        <Route path="/admin/requests" element={<Guard roles={['ADMIN']}><AdminRequests /></Guard>} />
        <Route path="/admin/database" element={<Guard roles={['ADMIN']}><AdminDatabase /></Guard>} />

        <Route path="/teacher" element={<Guard roles={['TEACHER']}><TeacherSchedule /></Guard>} />
        <Route path="/teacher/classes" element={<Guard roles={['TEACHER']}><TeacherClasses /></Guard>} />
        <Route path="/teacher/sessions/:id" element={<Guard roles={['TEACHER']}><TeacherSession /></Guard>} />
        <Route path="/teacher/requests" element={<Guard roles={['TEACHER']}><TeacherRequests /></Guard>} />

        <Route path="/student" element={<Guard roles={['STUDENT']}><StudentSchedule /></Guard>} />
        <Route path="/student/catalog" element={<Guard roles={['STUDENT']}><StudentCatalog /></Guard>} />
        <Route path="/student/teachers" element={<Guard roles={['STUDENT']}><StudentTeachers /></Guard>} />
        <Route path="/student/classes" element={<Guard roles={['STUDENT']}><StudentClasses /></Guard>} />
        <Route path="/student/attendance" element={<Guard roles={['STUDENT']}><StudentAttendance /></Guard>} />
      </Route>

      <Route
        path="*"
        element={
          loading ? <Loading /> : <Navigate to={user ? homeFor[user.role] : '/login'} replace />
        }
      />
    </Routes>
  );
}
