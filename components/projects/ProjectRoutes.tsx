import React from 'react';
import ProgrammeModule from '../ProgrammeModule';
import ProgrammesProjectsShell from '../ProgrammesProjectsShell';
import Projects from '../Projects';
import ProjectObjectWorkspace from '../project/workspace/ProjectObjectWorkspace';
import type { Project, User, TimeLog, Objective } from '../../types';

type Props = {
  currentView: 'programmes_projects' | 'projects' | 'project_workspace';
  language: string;
  canAccessModule: (m: string) => boolean;
  projects: Project[];
  users: User[];
  timeLogs: TimeLog[];
  objectives: Objective[];
  isLoading: boolean;
  loadingOperation: string | null;
  isDataLoaded: boolean;
  pendingNotification: any;
  selectedProjectId: string | null;
  handleSetView: (view: string) => void;
  handleUpdateProject: (project: Project) => void;
  handleAddProject: (project: Partial<Project>) => Promise<void>;
  handleDeleteProject: (id: string) => Promise<void>;
  handleAddTimeLog: (log: any) => void;
  handleNotificationHandled: () => void;
  handleOpenProjectWorkspace: (projectId: string) => void;
  handleCloseProjectWorkspace: () => void;
};

const ProjectRoutes: React.FC<Props> = ({
  currentView,
  language,
  canAccessModule,
  projects,
  users,
  timeLogs,
  objectives,
  isLoading,
  loadingOperation,
  isDataLoaded,
  pendingNotification,
  selectedProjectId,
  handleSetView,
  handleUpdateProject,
  handleAddProject,
  handleDeleteProject,
  handleAddTimeLog,
  handleNotificationHandled,
  handleOpenProjectWorkspace,
  handleCloseProjectWorkspace,
}) => {
  const isFr = (language || '').toLowerCase().startsWith('fr');

  if (currentView === 'programmes_projects') {
    return (
      <ProgrammesProjectsShell
        canAccessProgramme={canAccessModule('programme')}
        canAccessProjects={canAccessModule('projects')}
        isFr={isFr}
        programmePane={<ProgrammeModule />}
        projectsPane={
          <Projects
            projects={projects}
            users={users}
            timeLogs={timeLogs}
            onUpdateProject={handleUpdateProject}
            onAddProject={handleAddProject}
            onDeleteProject={handleDeleteProject}
            onAddTimeLog={handleAddTimeLog}
            objectives={objectives}
            setView={handleSetView}
            isLoading={isLoading}
            loadingOperation={loadingOperation}
            isDataLoaded={isDataLoaded}
            autoOpenProjectId={
              pendingNotification?.entityType === 'project' && pendingNotification.entityId ? String(pendingNotification.entityId) : null
            }
            onNotificationHandled={handleNotificationHandled}
            onOpenProjectWorkspace={handleOpenProjectWorkspace}
          />
        }
      />
    );
  }

  if (currentView === 'projects') {
    return (
      <Projects
        projects={projects}
        users={users}
        timeLogs={timeLogs}
        onUpdateProject={handleUpdateProject}
        onAddProject={handleAddProject}
        onDeleteProject={handleDeleteProject}
        onAddTimeLog={handleAddTimeLog}
        objectives={objectives}
        setView={handleSetView}
        isLoading={isLoading}
        loadingOperation={loadingOperation}
        isDataLoaded={isDataLoaded}
        autoOpenProjectId={
          pendingNotification?.entityType === 'project' && pendingNotification.entityId ? String(pendingNotification.entityId) : null
        }
        onNotificationHandled={handleNotificationHandled}
        onOpenProjectWorkspace={handleOpenProjectWorkspace}
      />
    );
  }

  // project_workspace
  if (!canAccessModule('projects')) {
    return null;
  }
  const pid = selectedProjectId;
  const activeProject = pid ? projects.find((p) => String(p.id) === String(pid)) : undefined;
  if (!activeProject) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-slate-600">
          {isFr ? 'Projet introuvable, retiré ou sans accès.' : 'Project not found, removed, or no access.'}
        </p>
        <button
          type="button"
          onClick={handleCloseProjectWorkspace}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0d1b2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3a5c]"
        >
          {isFr ? 'Retour aux projets' : 'Back to projects'}
        </button>
      </div>
    );
  }

  return (
    <ProjectObjectWorkspace
      project={activeProject}
      onClose={handleCloseProjectWorkspace}
      onUpdateProject={handleUpdateProject}
      onDeleteProject={handleDeleteProject}
      onAddTimeLog={handleAddTimeLog}
      timeLogs={timeLogs}
      objectives={objectives}
      setView={handleSetView}
      users={users}
    />
  );
};

export default ProjectRoutes;
