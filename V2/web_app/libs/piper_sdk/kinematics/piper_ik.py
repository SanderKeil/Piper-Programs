import math
from .piper_fk import C_PiperForwardKinematics
from .math_utils import Quaternion, Vector3

class C_PiperInverseKinematics:
    def __init__(self):
        self.fk = C_PiperForwardKinematics()
        self.dof = 6
    
    def solve_ik(self, target_pose, seed_joints, max_iter=100, tolerance=0.001):
        '''
        Numerical IK Solver using Jacobian Transpose / Damped Least Squares
        target_pose: [x, y, z, rx, ry, rz] (mm, degrees)
        seed_joints: [j1...j6] (degrees)
        '''
        # Convert inputs
        q_current = [math.radians(j) for j in seed_joints]
        
        target_pos = Vector3(target_pose[0], target_pose[1], target_pose[2])
        target_quat = Quaternion.from_euler(
            math.radians(target_pose[3]), 
            math.radians(target_pose[4]), 
            math.radians(target_pose[5])
        )

        for _ in range(max_iter):
            # 1. Forward Kinematics
            # fk returns list of [xyz, rpy] for each link. Last one is end effector.
            link_poses = self.fk.CalFK(q_current)
            end_pose = link_poses[5] # [x, y, z, r, p, y]
            
            # Current Pos
            curr_pos = Vector3(end_pose[0], end_pose[1], end_pose[2])
            
            # Current Rot (Convert FK Euler to Quat)
            # FK returns RPY in degrees? PiperFK says:
            # 'xyz': unit mm; 'rpy': unit degree.
            curr_quat = Quaternion.from_euler(
                math.radians(end_pose[3]), 
                math.radians(end_pose[4]), 
                math.radians(end_pose[5])
            )

            # 2. Error Calculation
            # Position Error
            err_pos = target_pos - curr_pos
            
            # Orientation Error (Quaternion)
            # q_err = target * current^-1
            # For small angles, vector part of q_err is approx half rotation axis * angle
            q_err = target_quat * curr_quat.inverse()
            # If w < 0, negate to take shortest path
            if q_err.w < 0:
                q_err.w = -q_err.w
                q_err.x = -q_err.x
                q_err.y = -q_err.y
                q_err.z = -q_err.z
            
            # Rotation error vector (radians) roughly 2 * q_err_xyz
            err_rot = Vector3(q_err.x * 2, q_err.y * 2, q_err.z * 2)

            # Check convergence
            if err_pos.norm() < tolerance and err_rot.norm() < math.radians(1.0):
                return [math.degrees(q) for q in q_current]

            # 3. Jacobian (Finite Difference)
            # J is 6x6 matrix.
            J = [[0.0]*6 for _ in range(6)]
            delta = 0.0001 # radian perturbation

            for j in range(6):
                q_perturbed = list(q_current)
                q_perturbed[j] += delta
                
                # FK for perturbation
                p_poses = self.fk.CalFK(q_perturbed)
                p_end = p_poses[5]
                p_pos = Vector3(p_end[0], p_end[1], p_end[2])
                p_quat = Quaternion.from_euler(
                    math.radians(p_end[3]), math.radians(p_end[4]), math.radians(p_end[5])
                )

                # Pos derivative
                d_pos = (p_pos - curr_pos) * (1.0 / delta)
                J[0][j] = d_pos.x
                J[1][j] = d_pos.y
                J[2][j] = d_pos.z
                
                # Rot derivative (angular velocity approx)
                # q_diff = p_quat * curr_quat^-1
                q_diff = p_quat * curr_quat.inverse()
                if q_diff.w < 0:
                    q_diff.w = -q_diff.w
                    q_diff.x = -q_diff.x
                    q_diff.y = -q_diff.y
                    q_diff.z = -q_diff.z
                d_rot = Vector3(q_diff.x*2/delta, q_diff.y*2/delta, q_diff.z*2/delta)
                J[3][j] = d_rot.x
                J[4][j] = d_rot.y
                J[5][j] = d_rot.z

            # 4. Solve for dq using Jacobian Transpose (simple but effective for positioning)
            # dq = alpha * J.T * error
            # Compute J.T * error
            error_vec = [err_pos.x, err_pos.y, err_pos.z, err_rot.x, err_rot.y, err_rot.z]
            
            dq = [0.0]*6
            for j in range(6):
                # Row j of J.T is Column j of J
                val = 0.0
                for r in range(6):
                    val += J[r][j] * error_vec[r]
                dq[j] = val
            
            # Scaling factor (alpha)
            # Simple adaptive step could be used, or fixed small step
            alpha = 0.0005 # Tuning required. Start conservative.
            
            for j in range(6):
                q_current[j] += alpha * dq[j]
        
        # Return best guess if max iter reached
        return [math.degrees(q) for q in q_current]
