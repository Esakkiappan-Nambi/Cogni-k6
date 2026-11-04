import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../services/api";

function ReportList() {

    const [reports, setReports] =
        useState([]);

    const navigate = useNavigate();

    useEffect(() => {
        let active = true;
        API.get("/test-runs")
            .then((response) => {
                if (active) setReports(response.data || []);
            })
            .catch((error) => {
                console.error(error);
            });
        return () => {
            active = false;
        };
    }, []);

    return (

        <div
            style={{
                padding:"20px"
            }}
        >

            <h1>
                Reports
            </h1>

            <table border="1">

                <thead>

                    <tr>

                        <th>Run ID</th>
                        <th>Status</th>
                        <th>Started At</th>
                        <th>Action</th>

                    </tr>

                </thead>

                <tbody>

                    {reports.map(
                        (report) => (

                        <tr key={report.id}>

                            <td>
                                {report.id}
                            </td>

                            <td>
                                {report.status}
                            </td>

                            <td>
                                {report.started_at}
                            </td>

                            <td>

                                <button
                                    onClick={() =>
                                        navigate(
                                            `/reports/${report.id}`
                                        )
                                    }
                                >
                                    View Report
                                </button>

                            </td>

                        </tr>

                    ))}

                </tbody>

            </table>

        </div>
    );
}

export default ReportList;