import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { AuthProvider, useAuth } from "./AuthContext";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Unauthorized from "./Unauthorized";
import ProtectedRoute from "./ProtectedRoute";
import { auth, functions } from "./firebase";

/** 운영에서는 false 유지. 개발 중에만 선생님 생성 툴바(uid / teacherName / Create Teacher)를 표시합니다. */
const ENABLE_DEV_TEACHER_TOOLBAR = false

function AdminTeacherCreationPanel() {
  const { role, loading } = useAuth()
  const [teacherUid, setTeacherUid] = useState("")
  const [teacherNameInput, setTeacherNameInput] = useState("")

  if (loading) return null
  if (!auth.currentUser) return null
  if (role !== "admin") return null

  async function handleCreateTeacher() {
    const uid = teacherUid.trim()
    const teacherName = teacherNameInput.trim()

    if (!uid || !teacherName) {
      alert("uid와 teacherName을 입력해주세요.")
      return
    }

    try {
      const setUserRole = httpsCallable(functions, "setUserRole")
      const result = await setUserRole({
        uid,
        role: "teacher",
        teacherName,
        isActive: true,
      })
      console.log(result.data)
      alert("선생님 계정 생성 완료")
      setTeacherUid("")
      setTeacherNameInput("")
    } catch (error) {
      alert("에러: " + error.message)
    }
  }

  return (
    <div style={{ padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <input
        type="text"
        placeholder="uid"
        value={teacherUid}
        onChange={(e) => setTeacherUid(e.target.value)}
        autoComplete="off"
        style={{ padding: "6px 8px", minWidth: 200 }}
      />
      <input
        type="text"
        placeholder="teacherName"
        value={teacherNameInput}
        onChange={(e) => setTeacherNameInput(e.target.value)}
        autoComplete="off"
        style={{ padding: "6px 8px", minWidth: 160 }}
      />
      <button type="button" onClick={handleCreateTeacher}>
        Create Teacher
      </button>
    </div>
  )
}

export default function App() {
  async function handleBootstrapAdmin() {
    try {
      const bootstrapAdmin = httpsCallable(functions, "bootstrapAdmin");
      const result = await bootstrapAdmin();
      console.log(result.data);
      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
      alert("관리자 권한 설정 완료");
    } catch (error) {
      alert("에러: " + error.message);
    }
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        {ENABLE_DEV_TEACHER_TOOLBAR ? <AdminTeacherCreationPanel /> : null}
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
