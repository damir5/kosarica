import { addTodo, listTodos } from './todos'
import { getConfigInfo } from './admin'
import { listUsers, getUser, updateUserRole, deleteUser, banUser } from './users'
import { getSettings, updateSettings } from './settings'

export default {
  listTodos,
  addTodo,
  admin: {
    getConfigInfo,
    users: {
      list: listUsers,
      get: getUser,
      updateRole: updateUserRole,
      delete: deleteUser,
      ban: banUser,
    },
    settings: {
      get: getSettings,
      update: updateSettings,
    },
  },
}
